from tests.test_projects import make_project


def make_doc(client, project_id, kind="note", title="제목", content="내용"):
    res = client.post(f"/api/projects/{project_id}/docs", json={"kind": kind, "title": title, "content": content})
    assert res.status_code == 201
    return res.json()


def test_create_idea_doc(client):
    p = make_project(client)
    d = make_doc(client, p["id"], kind="idea", title="사업 아이디어")
    assert d["kind"] == "idea" and d["updated_at"] is not None


def test_invalid_kind_rejected(client):
    p = make_project(client)
    res = client.post(f"/api/projects/{p['id']}/docs", json={"kind": "bogus", "title": "t", "content": "c"})
    assert res.status_code == 422


def test_get_put_delete(client):
    p = make_project(client)
    d = make_doc(client, p["id"], content="원본")
    assert client.get(f"/api/docs/{d['id']}").json()["content"] == "원본"

    res = client.put(f"/api/docs/{d['id']}", json={"content": "수정본", "kind": "world"})
    assert res.status_code == 200
    body = res.json()
    assert body["content"] == "수정본" and body["kind"] == "world"
    assert body["title"] == "제목"  # 안 보낸 필드 보존

    assert client.delete(f"/api/docs/{d['id']}").status_code == 204
    assert client.get(f"/api/docs/{d['id']}").status_code == 404


def test_doc_404s(client):
    assert client.get("/api/docs/999").status_code == 404
    assert client.put("/api/docs/999", json={"content": "x"}).status_code == 404
    assert client.delete("/api/docs/999").status_code == 404
