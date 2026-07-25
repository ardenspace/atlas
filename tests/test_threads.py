from tests.test_projects import make_project


def make_thread(client, project_id, title="세계관 스레드"):
    res = client.post(f"/api/projects/{project_id}/threads", json={"title": title})
    assert res.status_code == 201
    return res.json()


def test_get_thread_with_messages(client):
    p = make_project(client)
    t = make_thread(client, p["id"])
    body = client.get(f"/api/threads/{t['id']}").json()
    assert body["thread"]["title"] == "세계관 스레드"
    assert body["messages"] == []


def test_patch_title_and_archive(client):
    p = make_project(client)
    t = make_thread(client, p["id"])
    res = client.patch(f"/api/threads/{t['id']}", json={"archived": True})
    assert res.status_code == 200 and res.json()["archived"] == 1
    res = client.patch(f"/api/threads/{t['id']}", json={"title": "마무리됨"})
    assert res.json()["title"] == "마무리됨" and res.json()["archived"] == 1


def test_delete_thread(client):
    p = make_project(client)
    t = make_thread(client, p["id"])
    assert client.delete(f"/api/threads/{t['id']}").status_code == 204
    assert client.get(f"/api/threads/{t['id']}").status_code == 404


def test_thread_404s(client):
    assert client.get("/api/threads/999").status_code == 404
    assert client.patch("/api/threads/999", json={"title": "x"}).status_code == 404
    assert client.post("/api/projects/999/threads", json={"title": "x"}).status_code == 404


def test_empty_patch_returns_thread_unchanged(client):
    # 빈 패치는 UPDATE 없이 현재 스레드를 그대로 반환 (early-return 브랜치)
    p = make_project(client)
    t = make_thread(client, p["id"], title="원제목")
    res = client.patch(f"/api/threads/{t['id']}", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "원제목" and body["archived"] == 0
    assert body["id"] == t["id"]


def test_delete_missing_thread_404(client):
    assert client.delete("/api/threads/999").status_code == 404


def test_threads_ordered_by_last_activity(client):
    p = client.post("/api/projects", json={"name": "정렬"}).json()
    t1 = client.post(f"/api/projects/{p['id']}/threads", json={"title": "옛날"}).json()
    t2 = client.post(f"/api/projects/{p['id']}/threads", json={"title": "최신생성"}).json()

    # 생성순 동점(같은 초) → id DESC: t2 먼저
    ids = [t["id"] for t in client.get(f"/api/projects/{p['id']}").json()["threads"]]
    assert ids == [t2["id"], t1["id"]]

    # t1에 "더 최근" 메시지가 생기면 t1이 위로 — 타임스탬프를 직접 심는다
    from server import db
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO messages (thread_id, role, content, created_at) VALUES (?, 'user', '안녕', datetime('now', '+1 hour'))",
            (t1["id"],),
        )
    ids = [t["id"] for t in client.get(f"/api/projects/{p['id']}").json()["threads"]]
    assert ids == [t1["id"], t2["id"]]
