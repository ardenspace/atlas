"""web/dist 서빙 — dist 유무와 무관하게 결정론적으로 검증한다.

StaticFiles는 all_directories를 __init__에서 굳히므로, 실제 web/dist 존재 여부에
테스트가 좌우되지 않도록 그 속성을 tmp_path로 바꿔치기해 두 경우(빈 dist / index 있는
dist)를 재현한다. dist 디렉터리가 아예 없는 경우는 여기서 다루지 않는다 — 그때는
check_config의 RuntimeError→500이다 (아래 참조).

starlette 1.3.1은 첫 요청에서 check_config()가 self.directory를 stat 하므로
(check_dir=False로도 안 막힘), all_directories뿐 아니라 directory도 함께 바꿔치기하고
config_checked를 리셋해 패치된 디렉터리로 재검사되게 한다 — 플랜 셀프리뷰 ② 편차.
"""


def _static_app():
    from server.main import app

    for route in app.routes:
        if getattr(route, "name", None) == "web":
            return route.app
    raise AssertionError("web mount not found")


def _point_at(monkeypatch, static, directory):
    monkeypatch.setattr(static, "directory", str(directory))
    monkeypatch.setattr(static, "all_directories", [str(directory)])
    monkeypatch.setattr(static, "config_checked", False)


def test_api_routes_not_shadowed_by_root_mount(client):
    assert client.get("/api/projects").status_code == 200


def test_root_404_when_dist_empty(client, tmp_path, monkeypatch):
    empty = tmp_path / "dist"
    empty.mkdir()
    _point_at(monkeypatch, _static_app(), empty)
    assert client.get("/").status_code == 404


def test_root_serves_index_when_dist_exists(client, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>atlas</title>", encoding="utf-8")
    _point_at(monkeypatch, _static_app(), tmp_path)
    r = client.get("/")
    assert r.status_code == 200
    assert "atlas" in r.text
