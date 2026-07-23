import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def anyio_backend():
    # anyio pytest 플러그인이 trio까지 파라미터라이즈하는 것을 방지
    return "asyncio"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DB", str(tmp_path / "test.db"))
    from server.main import app

    with TestClient(app) as c:  # with 블록이 lifespan(db.init) 실행
        yield c
