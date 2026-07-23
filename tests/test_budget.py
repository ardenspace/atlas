import pytest

from tests.test_projects import make_project
from tests.test_threads import make_thread


@pytest.fixture
def fake_tokens(monkeypatch):
    from server import gemma

    async def fake_limit(**kw):
        return 8192

    async def fake_count(text, **kw):
        return len(text), True  # 1문자=1토큰으로 단순화

    monkeypatch.setattr(gemma, "context_limit", fake_limit)
    monkeypatch.setattr(gemma, "count_tokens", fake_count)


def test_budget_reports_docs_and_totals(client, fake_tokens):
    p = make_project(client)
    t = make_thread(client, p["id"])
    d1 = client.post(f"/api/projects/{p['id']}/docs", json={"kind": "idea", "title": "기획", "content": "가" * 100}).json()
    client.post(f"/api/projects/{p['id']}/docs", json={"kind": "note", "title": "노트", "content": "나" * 50})

    body = client.get(f"/api/threads/{t['id']}/budget").json()
    assert body["limit"] == 8192 and body["reserve"] == 2048 and body["exact"] is True
    assert {d["title"]: d["tokens"] for d in body["docs"]} == {"기획": 100, "노트": 50}
    assert body["total"] == body["system_tokens"] + body["history_tokens"]

    # doc_ids로 좁히면 해당 문서만
    body = client.get(f"/api/threads/{t['id']}/budget", params={"doc_ids": str(d1["id"])}).json()
    assert [d["title"] for d in body["docs"]] == ["기획"]


def test_budget_404_on_missing_thread(client, fake_tokens):
    assert client.get("/api/threads/999/budget").status_code == 404


def test_budget_400_on_non_integer_doc_ids(client, fake_tokens):
    p = make_project(client)
    t = make_thread(client, p["id"])
    # doc_ids가 정수 목록이 아니면 500이 아니라 400으로 거부 (파싱은 gemma 호출 전)
    res = client.get(f"/api/threads/{t['id']}/budget", params={"doc_ids": "abc"})
    assert res.status_code == 400
    assert "doc_ids" in res.json()["detail"]


def test_chat_rejected_with_413_when_over_limit(client, monkeypatch):
    from server import gemma

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

    p = make_project(client)
    t = make_thread(client, p["id"])
    res = client.post(f"/api/threads/{t['id']}/chat", json={"message": "하이"})
    assert res.status_code == 413
    assert "컨텍스트" in res.json()["detail"]
    # 거부된 요청은 user 메시지도 저장하지 않는다
    assert client.get(f"/api/threads/{t['id']}").json()["messages"] == []
