import json

import pytest

from tests.test_projects import make_project
from tests.test_threads import make_thread


def read_events(resp):
    return [line[len("data: "):] for line in resp.iter_lines() if line.startswith("data: ")]


@pytest.fixture
def fake_gemma(monkeypatch):
    from server import gemma

    state = {"system": None, "messages": None, "chunks": ["안녕", "하세요"], "raise_after": None}

    async def fake_stream(system, messages, **kw):
        state["system"] = system
        state["messages"] = messages
        for c in state["chunks"]:
            yield c
        if state["raise_after"] == "request_failed":
            raise gemma.GemmaRequestFailed(400)
        if state["raise_after"] == "unreachable":
            raise gemma.GemmaUnreachable()

    async def fake_limit(**kw):
        return None  # 기본: 가드 비활성 (Task 7에서 별도 테스트)

    monkeypatch.setattr(gemma, "stream_chat", fake_stream)
    monkeypatch.setattr(gemma, "context_limit", fake_limit)
    return state


def test_chat_streams_and_persists_both_messages(client, fake_gemma):
    p = make_project(client)
    t = make_thread(client, p["id"])
    with client.stream("POST", f"/api/threads/{t['id']}/chat", json={"message": "하이"}) as resp:
        assert resp.status_code == 200
        events = read_events(resp)
    assert json.loads(events[0]) == {"delta": "안녕"}
    assert events[-1] == "[DONE]"
    msgs = client.get(f"/api/threads/{t['id']}").json()["messages"]
    assert [(m["role"], m["content"]) for m in msgs] == [("user", "하이"), ("assistant", "안녕하세요")]


def test_chat_doc_selection_filters_system_prompt(client, fake_gemma):
    p = make_project(client)
    t = make_thread(client, p["id"])
    d1 = client.post(f"/api/projects/{p['id']}/docs", json={"kind": "idea", "title": "포함문서", "content": "a"}).json()
    client.post(f"/api/projects/{p['id']}/docs", json={"kind": "note", "title": "제외문서", "content": "b"})
    with client.stream(
        "POST", f"/api/threads/{t['id']}/chat", json={"message": "하이", "doc_ids": [d1["id"]]}
    ) as resp:
        read_events(resp)
    assert "포함문서" in fake_gemma["system"]
    assert "제외문서" not in fake_gemma["system"]


def test_chat_error_events_distinguish_causes(client, fake_gemma):
    p = make_project(client)
    t = make_thread(client, p["id"])

    fake_gemma["chunks"], fake_gemma["raise_after"] = [], "unreachable"
    with client.stream("POST", f"/api/threads/{t['id']}/chat", json={"message": "1"}) as resp:
        events = read_events(resp)
    assert "연결할 수 없" in json.loads(events[0])["error"]

    fake_gemma["raise_after"] = "request_failed"
    with client.stream("POST", f"/api/threads/{t['id']}/chat", json={"message": "2"}) as resp:
        events = read_events(resp)
    err = json.loads(events[0])["error"]
    assert "400" in err and "컨텍스트" in err


def test_chat_partial_output_is_saved_on_failure(client, fake_gemma):
    p = make_project(client)
    t = make_thread(client, p["id"])
    fake_gemma["chunks"], fake_gemma["raise_after"] = ["부분"], "request_failed"
    with client.stream("POST", f"/api/threads/{t['id']}/chat", json={"message": "하이"}) as resp:
        read_events(resp)
    msgs = client.get(f"/api/threads/{t['id']}").json()["messages"]
    assert [(m["role"], m["content"]) for m in msgs] == [("user", "하이"), ("assistant", "부분")]


def test_chat_history_never_starts_with_assistant(client, fake_gemma, monkeypatch):
    # HISTORY_LIMIT 잘림이 assistant 앞에서 끊기면 Gemma 템플릿(첫 턴 user 강제)이 깨진다
    from server import db, main

    monkeypatch.setattr(main, "HISTORY_LIMIT", 1)
    p = make_project(client)
    t = make_thread(client, p["id"])
    with db.connect() as conn:
        conn.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', '질문')", (t["id"],))
        conn.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'assistant', '답변')", (t["id"],))
    with client.stream("POST", f"/api/threads/{t['id']}/chat", json={"message": "새 질문"}) as resp:
        read_events(resp)
    # 히스토리 창(마지막 1개 = assistant)은 버려지고 새 user 메시지만 전송된다
    assert [m["role"] for m in fake_gemma["messages"]] == ["user"]
    assert fake_gemma["messages"][0]["content"] == "새 질문"


def test_chat_404_on_missing_thread(client, fake_gemma):
    assert client.post("/api/threads/999/chat", json={"message": "x"}).status_code == 404
