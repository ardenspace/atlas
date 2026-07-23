def make_project(client, name="테스트 프로젝트", brief=""):
    res = client.post("/api/projects", json={"name": name, "brief": brief})
    assert res.status_code == 201
    return res.json()


def test_create_and_list(client):
    p = make_project(client, "고양이 카페")
    assert p["slug"] == "고양이-카페"
    assert [x["id"] for x in client.get("/api/projects").json()] == [p["id"]]


def test_empty_or_blank_name_rejected(client):
    assert client.post("/api/projects", json={"name": ""}).status_code == 422
    assert client.post("/api/projects", json={"name": "   "}).status_code == 422


def test_duplicate_slug_conflict(client):
    make_project(client, "같은 이름")
    assert client.post("/api/projects", json={"name": "같은  이름"}).status_code == 409


def test_detail_includes_docs_and_threads(client):
    p = make_project(client)
    client.post(f"/api/projects/{p['id']}/docs", json={"kind": "note", "title": "메모", "content": "c"})
    client.post(f"/api/projects/{p['id']}/threads", json={"title": "첫 스레드"})
    body = client.get(f"/api/projects/{p['id']}").json()
    assert body["project"]["id"] == p["id"]
    assert [d["title"] for d in body["docs"]] == ["메모"]
    assert "content" not in body["docs"][0]  # 목록엔 메타만
    assert [t["title"] for t in body["threads"]] == ["첫 스레드"]


def test_patch_name_and_brief(client):
    p = make_project(client, "옛 이름", brief="옛 메모")
    res = client.patch(f"/api/projects/{p['id']}", json={"name": "새 이름"})
    assert res.status_code == 200
    assert res.json()["name"] == "새 이름"
    assert res.json()["slug"] == "새-이름"
    res = client.patch(f"/api/projects/{p['id']}", json={"brief": "새 메모"})
    assert res.json()["brief"] == "새 메모"
    assert res.json()["name"] == "새 이름"  # 다른 필드 보존


def test_patch_404_and_delete(client):
    assert client.patch("/api/projects/999", json={"brief": "x"}).status_code == 404
    p = make_project(client)
    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    assert client.get(f"/api/projects/{p['id']}").status_code == 404


def test_patch_rename_into_existing_slug_conflicts(client):
    # 두 번째 프로젝트를 첫 번째와 같은 slug로 rename → UNIQUE 충돌 → 409
    a = make_project(client, "첫 이름")
    b = make_project(client, "둘째 이름")
    res = client.patch(f"/api/projects/{b['id']}", json={"name": "첫  이름"})
    assert res.status_code == 409
    # 충돌 시 원본은 보존된다 (롤백)
    assert client.get(f"/api/projects/{b['id']}").json()["project"]["slug"] == "둘째-이름"
    assert client.get(f"/api/projects/{a['id']}").json()["project"]["slug"] == "첫-이름"
