import json

import pytest

from tests.test_chat import read_events
from tests.test_projects import make_project
from tests.test_threads import make_thread


@pytest.fixture
def fake_settle(monkeypatch):
    from server import gemma

    captured = {}

    async def fake_stream(system, messages, **kw):
        captured["system"] = system
        captured["messages"] = messages
        yield "# 정착 문서\n\n본문"

    async def fake_limit(**kw):
        return None  # 가드 비활성 — 413 경로는 별도 테스트에서 검증 (실제 :8080 호출 방지)

    monkeypatch.setattr(gemma, "stream_chat", fake_stream)
    monkeypatch.setattr(gemma, "context_limit", fake_limit)
    return captured


def _thread_with_chat(client):
    p = make_project(client)
    t = make_thread(client, p["id"])
    return p, t


def test_settle_streams_draft_and_writes_nothing(client, fake_settle):
    p, t = _thread_with_chat(client)
    # 대화 기록을 직접 심는다 (chat 경유 없이)
    from server import db

    with db.connect() as conn:
        conn.execute(
            "INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', '주인공은 고양이')", (t["id"],)
        )
        conn.execute(
            "INSERT INTO messages (thread_id, role, content) VALUES (?, 'assistant', '좋네요')", (t["id"],)
        )
    with client.stream("POST", f"/api/threads/{t['id']}/settle", json={}) as resp:
        assert resp.status_code == 200
        events = read_events(resp)
    assert json.loads(events[0])["delta"].startswith("# 정착 문서")
    assert events[-1] == "[DONE]"
    assert "주인공은 고양이" in fake_settle["messages"][0]["content"]
    # 문서·메시지 수 변화 없음
    assert client.get(f"/api/projects/{p['id']}").json()["docs"] == []
    assert len(client.get(f"/api/threads/{t['id']}").json()["messages"]) == 2


def test_settle_update_mode_includes_target_doc(client, fake_settle):
    p, t = _thread_with_chat(client)
    d = client.post(
        f"/api/projects/{p['id']}/docs", json={"kind": "world", "title": "설정집", "content": "주인공은 개"}
    ).json()
    from server import db

    with db.connect() as conn:
        conn.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', '수정하자')", (t["id"],))
    with client.stream("POST", f"/api/threads/{t['id']}/settle", json={"target_doc_id": d["id"]}) as resp:
        read_events(resp)
    assert "설정집" in fake_settle["system"] and "주인공은 개" in fake_settle["system"]


def test_settle_rejects_empty_thread(client, fake_settle):
    p, t = _thread_with_chat(client)
    assert client.post(f"/api/threads/{t['id']}/settle", json={}).status_code == 422


def test_settle_rejects_foreign_doc(client, fake_settle):
    p, t = _thread_with_chat(client)
    other = make_project(client, "다른 프로젝트")
    d = client.post(
        f"/api/projects/{other['id']}/docs", json={"kind": "world", "title": "남의 것", "content": "x"}
    ).json()
    from server import db

    with db.connect() as conn:
        conn.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', 'hi')", (t["id"],))
    assert client.post(f"/api/threads/{t['id']}/settle", json={"target_doc_id": d["id"]}).status_code == 422


def test_settle_rejected_with_413_when_over_limit(client, monkeypatch):
    from server import db, gemma

    async def fake_limit(**kw):
        return 1000

    async def fake_count(text, **kw):
        return 5000, True  # 한도 초과 강제

    async def fake_stream(system, messages, **kw):
        raise AssertionError("413 guard bypassed — stream_chat must not be reached")
        yield  # pragma: no cover — async generator 형태 유지용

    monkeypatch.setattr(gemma, "context_limit", fake_limit)
    monkeypatch.setattr(gemma, "count_tokens", fake_count)
    monkeypatch.setattr(gemma, "stream_chat", fake_stream)

    p, t = _thread_with_chat(client)
    with db.connect() as conn:
        conn.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', 'hi')", (t["id"],))
    res = client.post(f"/api/threads/{t['id']}/settle", json={})
    assert res.status_code == 413
    assert "컨텍스트" in res.json()["detail"]


def test_settle_413_guard_counts_template_overhead(client, monkeypatch):
    # 원문 토큰만으로는 가드를 통과하지만 메시지당 템플릿 래퍼 오버헤드를 더하면 넘겨야 413
    from server import db, gemma

    async def fake_limit(**kw):
        return 3000

    async def fake_count(text, **kw):
        return 3000 - gemma.RESPONSE_RESERVE - 5, True  # 947 — 원문만으론 952 아래

    async def fake_stream(system, messages, **kw):
        raise AssertionError("413 guard bypassed — stream_chat must not be reached")
        yield  # pragma: no cover — async generator 형태 유지용

    monkeypatch.setattr(gemma, "context_limit", fake_limit)
    monkeypatch.setattr(gemma, "count_tokens", fake_count)
    monkeypatch.setattr(gemma, "stream_chat", fake_stream)

    p, t = _thread_with_chat(client)
    with db.connect() as conn:
        conn.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', 'hi')", (t["id"],))
    # system + transcript = 2 메시지 → 오버헤드 2*10=20; 947+20=967 > 952 → 413
    res = client.post(f"/api/threads/{t['id']}/settle", json={})
    assert res.status_code == 413
    assert "컨텍스트" in res.json()["detail"]
