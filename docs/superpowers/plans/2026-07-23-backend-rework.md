# atlas 백엔드 재정비 Implementation Plan (1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** atlas 백엔드를 합의된 도메인 모델(idea kind, 다중 스레드, 정착, 컨텍스트 예산)로 재정비하고 전 엔드포인트를 pytest로 검증한다.

**Architecture:** FastAPI + SQLite 단일 파일 구조 유지. 스키마를 v2로 마이그레이션(threads 테이블, docs.kind에 'idea', updated_at), 문서/프로젝트/스레드 CRUD 완성, 채팅을 스레드 기반으로 이전하며 오류 구분·부분 저장·컨텍스트 가드를 넣는다. llama-server 연동은 gemma.py에 격리하고 transport 주입으로 테스트한다.

**Tech Stack:** Python ≥3.12, FastAPI, SQLite(stdlib sqlite3), httpx, uv, pytest (+ anyio pytest plugin, httpx.MockTransport)

## Global Constraints

- atlas 서버 포트 **8787**. llama-server **:8080은 이 프로젝트 소유가 아님** — 테스트는 절대 실제 :8080을 치지 않는다 (모킹/MockTransport만).
- DB 경로: `data/atlas.db`, 환경변수 `ATLAS_DB`로 오버라이드. llama 주소: `ATLAS_LLAMA_BASE` (기본 `http://127.0.0.1:8080`).
- 문서 kind: `idea | research | world | note` (이 순서가 시스템 프롬프트 섹션 순서).
- `HISTORY_LIMIT = 30` (채팅 히스토리), `RESPONSE_RESERVE = 2048` (응답용 토큰 여유).
- 인증 없음 (Tailscale 전제). 8787을 공개 인터넷에 노출하지 않는다.
- 테스트 실행: `uv run pytest`. 서버 실행: `uv run uvicorn server.main:app --host 0.0.0.0 --port 8787`.
- 커밋은 태스크마다. 기존 바닐라 web/ UI는 이 계획에서 **의도적으로 깨진다** (계획 2에서 React로 대체) — web/ 파일은 건드리지 않는다.

## 최종 API 표면 (계획 2·3이 의존하는 계약)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{ok, gemma}` |
| GET | `/api/projects` | | `[project]` |
| POST | `/api/projects` | `{name, brief?}` | `project` (201) |
| GET | `/api/projects/{id}` | | `{project, docs:[meta], threads:[meta]}` |
| PATCH | `/api/projects/{id}` | `{name?, brief?}` | `project` |
| DELETE | `/api/projects/{id}` | | 204 |
| POST | `/api/projects/{id}/docs` | `{kind, title, content}` | `doc` (201) |
| GET | `/api/docs/{id}` | | `doc` |
| PUT | `/api/docs/{id}` | `{kind?, title?, content?}` | `doc` |
| DELETE | `/api/docs/{id}` | | 204 |
| POST | `/api/projects/{id}/threads` | `{title}` | `thread` (201) |
| GET | `/api/threads/{id}` | | `{thread, messages}` |
| PATCH | `/api/threads/{id}` | `{title?, archived?}` | `thread` |
| DELETE | `/api/threads/{id}` | | 204 |
| GET | `/api/threads/{id}/budget` | `?doc_ids=1,2` (생략=전체) | `{limit, reserve, total, system_tokens, history_tokens, docs:[{id,title,tokens}], exact}` |
| POST | `/api/threads/{id}/chat` | `{message, doc_ids?}` | SSE `{delta}`/`{error}`/`[DONE]`; 413 컨텍스트 초과 |
| POST | `/api/threads/{id}/settle` | `{target_doc_id?}` | SSE (문서 초안 스트림, DB 저장 없음) |

SSE 이벤트 형식: `data: {"delta": "..."}\n\n`, 오류 시 `data: {"error": "..."}\n\n`, 종료 `data: [DONE]\n\n`.

---

### Task 1: 테스트 인프라 + db.py v2 (스키마·마이그레이션·커넥션 수명)

**Files:**
- Modify: `server/db.py` (전면 재작성)
- Modify: `server/main.py` (import-time `db.init()` → lifespan으로 이동만)
- Create: `tests/__init__.py` (빈 파일 — 테스트 간 `from tests.test_projects import ...` 크로스 임포트를 위해 필수)
- Create: `tests/conftest.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Produces: `db.connect()` — **contextmanager** (`with db.connect() as conn:`; 성공 시 commit, 예외 시 rollback, 항상 close). `db.init()` — 멱등, `ATLAS_DB` 경로에 v2 스키마 생성 또는 v1→v2 마이그레이션. `db.db_path() -> Path`.
- v2 스키마: `projects(id, slug UNIQUE, name, brief, created_at)` / `docs(id, project_id FK CASCADE, kind CHECK(idea|research|world|note), title, content, created_at, updated_at)` / `threads(id, project_id FK CASCADE, title, archived INT DEFAULT 0, created_at)` / `messages(id, thread_id FK CASCADE, role CHECK(user|assistant), content, created_at)`

- [ ] **Step 1: dev 의존성 추가**

```bash
uv add --dev pytest
```

- [ ] **Step 2: conftest 작성**

```bash
touch tests/__init__.py
```

`tests/conftest.py`:

```python
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
```

- [ ] **Step 3: 실패하는 테스트 작성**

`tests/test_db.py`:

```python
import sqlite3

import pytest


def _init_at(tmp_path, monkeypatch, name="t.db"):
    monkeypatch.setenv("ATLAS_DB", str(tmp_path / name))
    from server import db

    db.init()
    return db


def test_v2_schema_created(tmp_path, monkeypatch):
    db = _init_at(tmp_path, monkeypatch)
    with db.connect() as conn:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"projects", "docs", "threads", "messages"} <= tables
    with db.connect() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2


def test_idea_kind_allowed_and_bad_kind_rejected(tmp_path, monkeypatch):
    db = _init_at(tmp_path, monkeypatch)
    with db.connect() as conn:
        conn.execute("INSERT INTO projects (slug, name) VALUES ('p', 'P')")
        conn.execute("INSERT INTO docs (project_id, kind, title, content) VALUES (1, 'idea', 't', 'c')")
    with pytest.raises(sqlite3.IntegrityError):
        with db.connect() as conn:
            conn.execute("INSERT INTO docs (project_id, kind, title, content) VALUES (1, 'bogus', 't', 'c')")


def test_delete_project_cascades(tmp_path, monkeypatch):
    db = _init_at(tmp_path, monkeypatch)
    with db.connect() as conn:
        conn.execute("INSERT INTO projects (slug, name) VALUES ('p', 'P')")
        conn.execute("INSERT INTO threads (project_id, title) VALUES (1, '스레드')")
        conn.execute("INSERT INTO messages (thread_id, role, content) VALUES (1, 'user', 'hi')")
        conn.execute("INSERT INTO docs (project_id, kind, title, content) VALUES (1, 'note', 't', 'c')")
    with db.connect() as conn:
        conn.execute("DELETE FROM projects WHERE id = 1")
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) c FROM messages").fetchone()["c"] == 0
        assert conn.execute("SELECT count(*) c FROM docs").fetchone()["c"] == 0
        assert conn.execute("SELECT count(*) c FROM threads").fetchone()["c"] == 0


def test_connect_rolls_back_on_error_and_closes(tmp_path, monkeypatch):
    db = _init_at(tmp_path, monkeypatch)
    with pytest.raises(RuntimeError):
        with db.connect() as conn:
            conn.execute("INSERT INTO projects (slug, name) VALUES ('p', 'P')")
            raise RuntimeError("boom")
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) c FROM projects").fetchone()["c"] == 0


V1_SCHEMA = """
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('research', 'world', 'note')),
    title TEXT NOT NULL, content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
"""


def test_migrates_v1_db(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    raw = sqlite3.connect(path)
    raw.executescript(V1_SCHEMA)
    raw.execute("INSERT INTO projects (slug, name) VALUES ('p', 'P')")
    raw.execute("INSERT INTO docs (project_id, kind, title, content) VALUES (1, 'research', '리포트', '본문')")
    raw.execute("INSERT INTO messages (project_id, role, content) VALUES (1, 'user', '첫 마디')")
    raw.execute("INSERT INTO messages (project_id, role, content) VALUES (1, 'assistant', '답변')")
    raw.commit()
    raw.close()

    monkeypatch.setenv("ATLAS_DB", str(path))
    from server import db

    db.init()
    with db.connect() as conn:
        # 기존 문서 보존 + updated_at 채워짐
        doc = conn.execute("SELECT * FROM docs").fetchone()
        assert doc["title"] == "리포트" and doc["updated_at"] is not None
        # 기존 메시지는 '이전 대화' 스레드로 이관
        thread = conn.execute("SELECT * FROM threads").fetchone()
        assert thread["title"] == "이전 대화" and thread["project_id"] == 1
        msgs = conn.execute("SELECT * FROM messages ORDER BY id").fetchall()
        assert [m["content"] for m in msgs] == ["첫 마디", "답변"]
        assert all(m["thread_id"] == thread["id"] for m in msgs)
        # idea kind 사용 가능
        conn.execute("INSERT INTO docs (project_id, kind, title, content) VALUES (1, 'idea', 'i', 'c')")

    db.init()  # 멱등성: 두 번 불러도 무해
```

- [ ] **Step 4: 실패 확인**

Run: `uv run pytest tests/test_db.py -v`
Expected: FAIL (`AttributeError`/`sqlite3.OperationalError` — v2 스키마·contextmanager 부재)

- [ ] **Step 5: db.py 재작성**

`server/db.py` 전체:

```python
"""SQLite storage for atlas. Single-file DB under data/ (override with ATLAS_DB env)."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "atlas.db"
SCHEMA_VERSION = 2

_PROJECTS_SQL = """
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

_REST_SQL = """
CREATE TABLE docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('idea', 'research', 'world', 'note')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

SCHEMA = _PROJECTS_SQL + _REST_SQL

# v1(스캐폴드): docs.kind에 idea 없음, messages가 project_id 직결, threads 없음.
# 기존 메시지는 프로젝트별 '이전 대화' 스레드를 만들어 이관한다.
_MIGRATE_V1 = (
    """
ALTER TABLE docs RENAME TO docs_v1;
ALTER TABLE messages RENAME TO messages_v1;
"""
    + _REST_SQL
    + """
INSERT INTO docs (id, project_id, kind, title, content, created_at, updated_at)
    SELECT id, project_id, kind, title, content, created_at, created_at FROM docs_v1;
INSERT INTO threads (project_id, title)
    SELECT DISTINCT project_id, '이전 대화' FROM messages_v1;
INSERT INTO messages (thread_id, role, content, created_at)
    SELECT t.id, m.role, m.content, m.created_at
    FROM messages_v1 m JOIN threads t ON t.project_id = m.project_id
    ORDER BY m.id;
DROP TABLE docs_v1;
DROP TABLE messages_v1;
"""
)


def db_path() -> Path:
    return Path(os.environ.get("ATLAS_DB", str(DEFAULT_DB)))


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:  # 트랜잭션: 정상 종료 시 commit, 예외 시 rollback
            yield conn
    finally:
        conn.close()


def init() -> None:
    db_path().parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path())
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version >= SCHEMA_VERSION:
            return
        legacy = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        conn.executescript(_MIGRATE_V1 if (version == 0 and legacy) else SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 6: main.py의 init을 lifespan으로 이동**

`server/main.py`에서 `app = FastAPI(title="atlas")` 위의 `db.init()` 줄을 지우고:

```python
from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(title="atlas", lifespan=lifespan)
```

주의: 기존 `/api/projects/{id}/chat` 엔드포인트는 이 시점부터 v2 스키마와 안 맞아 런타임에 깨진다 (Task 6에서 스레드 기반으로 대체). `with db.connect() as conn:` 호출부는 시그니처가 동일해 그대로 동작한다.

- [ ] **Step 7: 통과 확인**

Run: `uv run pytest tests/test_db.py -v`
Expected: PASS (6 tests)

- [ ] **Step 8: Commit**

```bash
git add server/db.py server/main.py tests/ pyproject.toml uv.lock
git commit -m "feat: schema v2 (threads, idea kind, updated_at) + v1 migration + test infra"
```

---

### Task 2: projects API 정비 (검증·PATCH·DELETE·상세)

**Files:**
- Modify: `server/main.py`
- Test: `tests/test_projects.py`

**Interfaces:**
- Consumes: Task 1의 `db.connect()`
- Produces: `GET /api/projects/{id}` → `{project, docs:[{id,kind,title,created_at,updated_at}], threads:[{id,title,archived,created_at}]}`; `PATCH /api/projects/{id}` `{name?, brief?}`; `DELETE /api/projects/{id}` → 204. 헬퍼 `get_project_or_404(conn, project_id) -> dict`, `slugify(name) -> str`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_projects.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_projects.py -v`
Expected: FAIL (threads 엔드포인트 405/404, PATCH 405, 빈 이름 201 등)

- [ ] **Step 3: main.py 구현**

`server/main.py`의 모델·프로젝트 엔드포인트를 아래로 교체 (Task 4의 threads POST는 이 태스크의 테스트가 쓰므로 **최소 형태로 여기서 함께 추가**):

```python
import sqlite3
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class ProjectIn(BaseModel):
    name: Name
    brief: str = ""


class ProjectPatch(BaseModel):
    name: Name | None = None
    brief: str | None = None


class DocIn(BaseModel):
    kind: Literal["idea", "research", "world", "note"]
    title: Name
    content: str


class ThreadIn(BaseModel):
    title: Name


def slugify(name: str) -> str:
    return "-".join(name.lower().split())


def get_project_or_404(conn, project_id: int) -> dict:
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "project not found")
    return dict(row)


@app.get("/api/projects")
def list_projects():
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/projects", status_code=201)
def create_project(p: ProjectIn):
    with db.connect() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO projects (slug, name, brief) VALUES (?, ?, ?)",
                (slugify(p.name), p.name, p.brief),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "project with same slug exists")
        return dict(conn.execute("SELECT * FROM projects WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.get("/api/projects/{project_id}")
def get_project(project_id: int):
    with db.connect() as conn:
        project = get_project_or_404(conn, project_id)
        docs = conn.execute(
            "SELECT id, kind, title, created_at, updated_at FROM docs WHERE project_id = ? ORDER BY id",
            (project_id,),
        ).fetchall()
        threads = conn.execute(
            "SELECT id, title, archived, created_at FROM threads WHERE project_id = ? ORDER BY id DESC",
            (project_id,),
        ).fetchall()
    return {"project": project, "docs": [dict(d) for d in docs], "threads": [dict(t) for t in threads]}


@app.patch("/api/projects/{project_id}")
def update_project(project_id: int, patch: ProjectPatch):
    fields = patch.model_dump(exclude_none=True)
    with db.connect() as conn:
        project = get_project_or_404(conn, project_id)
        if not fields:
            return project
        if "name" in fields:
            fields["slug"] = slugify(fields["name"])
        sets = ", ".join(f"{k} = ?" for k in fields)
        try:
            conn.execute(f"UPDATE projects SET {sets} WHERE id = ?", (*fields.values(), project_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "project with same slug exists")
        return dict(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: int):
    with db.connect() as conn:
        get_project_or_404(conn, project_id)
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))


@app.post("/api/projects/{project_id}/threads", status_code=201)
def create_thread(project_id: int, t: ThreadIn):
    with db.connect() as conn:
        get_project_or_404(conn, project_id)
        cur = conn.execute("INSERT INTO threads (project_id, title) VALUES (?, ?)", (project_id, t.title))
        return dict(conn.execute("SELECT * FROM threads WHERE id = ?", (cur.lastrowid,)).fetchone())
```

기존 `class ChatIn`·`slugify`·`get_project_or_404`·`list_projects`·`create_project`·`get_project`(구버전)·`from . import db, gemma`의 `db.sqlite3` 참조는 위 코드로 대체된다. `add_doc`의 수동 kind 체크(`if doc.kind not in ...`)는 `DocIn`의 `Literal`이 대신하므로 삭제.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_projects.py tests/test_db.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_projects.py
git commit -m "feat: project validation, detail with threads, PATCH/DELETE"
```

---

### Task 3: docs CRUD (idea kind, 수정·삭제, updated_at)

**Files:**
- Modify: `server/main.py`
- Test: `tests/test_docs.py`

**Interfaces:**
- Consumes: Task 2의 `get_project_or_404`, `DocIn`, `Name`
- Produces: `GET/PUT/DELETE /api/docs/{id}` (플랫 경로 — 구 `GET /api/projects/{pid}/docs/{id}`는 제거), 헬퍼 `get_doc_or_404(conn, doc_id) -> dict`. doc 응답에 `updated_at` 포함.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_docs.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_docs.py -v`
Expected: FAIL (`GET /api/docs/{id}` 404가 아니라 405/404 라우트 부재, PUT/DELETE 부재)

- [ ] **Step 3: 구현**

`server/main.py` — 구 `get_doc`(중첩 경로)을 지우고, `add_doc`을 교체하고 아래 추가:

```python
class DocPatch(BaseModel):
    kind: Literal["idea", "research", "world", "note"] | None = None
    title: Name | None = None
    content: str | None = None


def get_doc_or_404(conn, doc_id: int) -> dict:
    row = conn.execute("SELECT * FROM docs WHERE id = ?", (doc_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "doc not found")
    return dict(row)


@app.post("/api/projects/{project_id}/docs", status_code=201)
def add_doc(project_id: int, doc: DocIn):
    with db.connect() as conn:
        get_project_or_404(conn, project_id)
        cur = conn.execute(
            "INSERT INTO docs (project_id, kind, title, content) VALUES (?, ?, ?, ?)",
            (project_id, doc.kind, doc.title, doc.content),
        )
        return dict(conn.execute("SELECT * FROM docs WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.get("/api/docs/{doc_id}")
def get_doc(doc_id: int):
    with db.connect() as conn:
        return get_doc_or_404(conn, doc_id)


@app.put("/api/docs/{doc_id}")
def update_doc(doc_id: int, patch: DocPatch):
    fields = patch.model_dump(exclude_none=True)
    with db.connect() as conn:
        get_doc_or_404(conn, doc_id)
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(
                f"UPDATE docs SET {sets}, updated_at = datetime('now') WHERE id = ?",
                (*fields.values(), doc_id),
            )
        return dict(conn.execute("SELECT * FROM docs WHERE id = ?", (doc_id,)).fetchone())


@app.delete("/api/docs/{doc_id}", status_code=204)
def delete_doc(doc_id: int):
    with db.connect() as conn:
        get_doc_or_404(conn, doc_id)
        conn.execute("DELETE FROM docs WHERE id = ?", (doc_id,))
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v`
Expected: PASS (test_db, test_projects, test_docs 전부)

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_docs.py
git commit -m "feat: doc CRUD with idea kind and updated_at"
```

---

### Task 4: threads API (조회·수정·삭제)

**Files:**
- Modify: `server/main.py`
- Test: `tests/test_threads.py`

**Interfaces:**
- Consumes: Task 2의 `create_thread`, `Name`
- Produces: `GET /api/threads/{id}` → `{thread, messages:[{id,role,content,created_at}]}`; `PATCH /api/threads/{id}` `{title?, archived?}`; `DELETE` → 204. 헬퍼 `get_thread_or_404(conn, thread_id) -> dict`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_threads.py`:

```python
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
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_threads.py -v`
Expected: FAIL (GET/PATCH/DELETE 라우트 부재)

- [ ] **Step 3: 구현**

`server/main.py`에 추가:

```python
class ThreadPatch(BaseModel):
    title: Name | None = None
    archived: bool | None = None


def get_thread_or_404(conn, thread_id: int) -> dict:
    row = conn.execute("SELECT * FROM threads WHERE id = ?", (thread_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "thread not found")
    return dict(row)


@app.get("/api/threads/{thread_id}")
def get_thread(thread_id: int):
    with db.connect() as conn:
        thread = get_thread_or_404(conn, thread_id)
        messages = conn.execute(
            "SELECT id, role, content, created_at FROM messages WHERE thread_id = ? ORDER BY id",
            (thread_id,),
        ).fetchall()
    return {"thread": thread, "messages": [dict(m) for m in messages]}


@app.patch("/api/threads/{thread_id}")
def update_thread(thread_id: int, patch: ThreadPatch):
    fields = patch.model_dump(exclude_none=True)
    with db.connect() as conn:
        thread = get_thread_or_404(conn, thread_id)
        if not fields:
            return thread
        if "archived" in fields:
            fields["archived"] = int(fields["archived"])
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE threads SET {sets} WHERE id = ?", (*fields.values(), thread_id))
        return dict(conn.execute("SELECT * FROM threads WHERE id = ?", (thread_id,)).fetchone())


@app.delete("/api/threads/{thread_id}", status_code=204)
def delete_thread(thread_id: int):
    with db.connect() as conn:
        get_thread_or_404(conn, thread_id)
        conn.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_threads.py
git commit -m "feat: thread get/patch/delete"
```

---

### Task 5: gemma.py 재작성 (오류 구분·토큰 API·프롬프트 빌더)

**Files:**
- Modify: `server/gemma.py` (전면 재작성)
- Test: `tests/test_gemma.py`

**Interfaces:**
- Produces (main.py와 계획 2·3이 의존):
  - `class GemmaUnreachable(Exception)` / `class GemmaRequestFailed(Exception)` (`.status_code: int`)
  - `RESPONSE_RESERVE = 2048`, `KIND_LABEL: dict`, `KIND_ORDER: list`
  - `build_system_prompt(project: dict, docs: list[dict]) -> str` — kind 순서(idea→research→world→note)로 섹션 구성
  - `build_settle_messages(messages: list[dict], target_doc: dict | None) -> tuple[str, list[dict]]`
  - `async stream_chat(system, messages, *, transport=None) -> AsyncIterator[str]`
  - `async context_limit(*, transport=None) -> int | None` (llama `/props`의 n_ctx)
  - `async count_tokens(text, *, transport=None) -> tuple[int, bool]` ((토큰수, 정확여부); 서버 없으면 `len//3` 추정에 False)
  - `async is_alive(*, transport=None) -> bool`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_gemma.py`:

```python
import httpx
import pytest

from server import gemma

SSE = (
    b'data: {"choices":[{"delta":{"content":"\xec\x95\x88"}}]}\n\n'
    b'data: {"choices":[{"delta":{"content":"\xeb\x85\x95"}}]}\n\n'
    b"data: [DONE]\n\n"
)


@pytest.mark.anyio
async def test_stream_chat_yields_deltas():
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=SSE))
    out = [d async for d in gemma.stream_chat("sys", [], transport=transport)]
    assert out == ["안", "녕"]


@pytest.mark.anyio
async def test_stream_chat_raises_request_failed_on_400():
    transport = httpx.MockTransport(lambda req: httpx.Response(400, json={"error": "ctx"}))
    with pytest.raises(gemma.GemmaRequestFailed) as ei:
        async for _ in gemma.stream_chat("sys", [], transport=transport):
            pass
    assert ei.value.status_code == 400


@pytest.mark.anyio
async def test_stream_chat_raises_unreachable_on_connect_error():
    def boom(req):
        raise httpx.ConnectError("refused", request=req)

    with pytest.raises(gemma.GemmaUnreachable):
        async for _ in gemma.stream_chat("sys", [], transport=httpx.MockTransport(boom)):
            pass


@pytest.mark.anyio
async def test_context_limit_and_count_tokens():
    def handler(req):
        if req.url.path == "/props":
            return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 8192}})
        if req.url.path == "/tokenize":
            return httpx.Response(200, json={"tokens": [1, 2, 3]})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    assert await gemma.context_limit(transport=transport) == 8192
    assert await gemma.count_tokens("아무 텍스트", transport=transport) == (3, True)


@pytest.mark.anyio
async def test_count_tokens_estimates_when_unreachable():
    def boom(req):
        raise httpx.ConnectError("refused", request=req)

    n, exact = await gemma.count_tokens("가" * 30, transport=httpx.MockTransport(boom))
    assert n == 10 and exact is False


def test_build_system_prompt_orders_kinds():
    project = {"name": "P", "brief": "메모"}
    docs = [
        {"kind": "world", "title": "W", "content": "w"},
        {"kind": "idea", "title": "I", "content": "i"},
        {"kind": "research", "title": "R", "content": "r"},
    ]
    out = gemma.build_system_prompt(project, docs)
    assert out.index("[기획] I") < out.index("[조사 리포트] R") < out.index("[세계관 문서] W")


def test_build_settle_messages_new_and_update():
    msgs = [{"role": "user", "content": "주인공은 고양이"}, {"role": "assistant", "content": "좋아요"}]
    system, prompt = gemma.build_settle_messages(msgs, None)
    assert "서기" in system
    assert "[사용자] 주인공은 고양이" in prompt[0]["content"]

    target = {"title": "설정집", "content": "주인공은 개"}
    system, _ = gemma.build_settle_messages(msgs, target)
    assert "설정집" in system and "주인공은 개" in system
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_gemma.py -v`
Expected: FAIL (`AttributeError: GemmaRequestFailed` 등)

- [ ] **Step 3: gemma.py 재작성**

`server/gemma.py` 전체:

```python
"""Client for the local llama-server (Gemma) OpenAI-compatible API."""
import json
import os
from typing import AsyncIterator

import httpx

LLAMA_BASE = os.environ.get("ATLAS_LLAMA_BASE", "http://127.0.0.1:8080")

# 응답 생성용으로 남겨두는 컨텍스트 여유 (토큰)
RESPONSE_RESERVE = 2048

KIND_LABEL = {"idea": "기획", "research": "조사 리포트", "world": "세계관 문서", "note": "노트"}
KIND_ORDER = ["idea", "research", "world", "note"]


class GemmaUnreachable(Exception):
    """llama-server에 연결 자체가 안 됨."""


class GemmaRequestFailed(Exception):
    """llama-server가 오류 상태 코드를 반환함 (컨텍스트 초과 등)."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"llama-server returned HTTP {status_code}")


SYSTEM_TEMPLATE = """당신은 마케팅 프로젝트의 콘텐츠 세계관을 함께 짓는 기획 파트너다. \
아래 자료는 역할이 다르다: 기획은 인간의 의도, 조사 리포트는 웹에서 검증된 근거, \
세계관 문서는 지금까지 합의된 정설, 노트는 잡메모다. \
자료에 근거해 대화하되 자료에 없는 것은 추측임을 밝히고, 세계관 문서와 모순되는 제안을 할 때는 \
무엇과 모순되는지 명시하라. 결론을 서두르지 말고 선택지와 트레이드오프를 보여줘라. 한국어로 대화한다.

# 프로젝트: {name}
한 줄 소개: {brief}

{docs}"""


def build_system_prompt(project: dict, docs: list[dict]) -> str:
    sections = []
    for kind in KIND_ORDER:
        for d in docs:
            if d["kind"] == kind:
                sections.append(f"## [{KIND_LABEL[kind]}] {d['title']}\n{d['content']}")
    return SYSTEM_TEMPLATE.format(
        name=project["name"],
        brief=project["brief"] or "(없음)",
        docs="\n\n".join(sections) or "(아직 문서 없음)",
    )


SETTLE_NEW_SYSTEM = """당신은 세계관 기획 대화의 서기다. 아래 대화에서 합의에 도달한 세계관 요소만 추출해 \
하나의 마크다운 문서로 정리하라. 탐색만 하다 만 아이디어나 기각된 안은 넣지 않는다. \
첫 줄은 '# 제목' 형식의 문서 제목, 그 뒤에 본문. 문서 본문 외 다른 말은 출력하지 않는다. 한국어로 쓴다."""

SETTLE_UPDATE_SYSTEM = """당신은 세계관 기획 대화의 서기다. 아래 '기존 문서'를 이번 대화에서 합의된 내용으로 \
갱신한 개정판 전체를 출력하라. 대화와 모순되지 않는 기존 내용은 유지하고, 뒤집힌 설정은 새 합의로 교체한다. \
첫 줄은 '# 제목' 형식의 문서 제목, 그 뒤에 본문. 문서 본문 외 다른 말은 출력하지 않는다. 한국어로 쓴다.

# 기존 문서: {title}
{content}"""


def build_settle_messages(messages: list[dict], target_doc: dict | None) -> tuple[str, list[dict]]:
    system = (
        SETTLE_UPDATE_SYSTEM.format(title=target_doc["title"], content=target_doc["content"])
        if target_doc
        else SETTLE_NEW_SYSTEM
    )
    transcript = "\n\n".join(
        f"[{'사용자' if m['role'] == 'user' else 'Gemma'}] {m['content']}" for m in messages
    )
    return system, [{"role": "user", "content": f"# 대화 기록\n\n{transcript}"}]


def _client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(300, connect=5), transport=transport)


async def stream_chat(
    system: str, messages: list[dict], *, transport: httpx.AsyncBaseTransport | None = None
) -> AsyncIterator[str]:
    payload = {"messages": [{"role": "system", "content": system}, *messages], "stream": True}
    try:
        async with _client(transport) as client:
            async with client.stream(
                "POST", f"{LLAMA_BASE}/v1/chat/completions", json=payload
            ) as resp:
                if resp.status_code >= 400:
                    raise GemmaRequestFailed(resp.status_code)
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[len("data: "):]
                    if data.strip() == "[DONE]":
                        break
                    delta = json.loads(data)["choices"][0]["delta"]
                    if content := delta.get("content"):
                        yield content
    except httpx.TransportError as e:
        raise GemmaUnreachable() from e


async def context_limit(*, transport: httpx.AsyncBaseTransport | None = None) -> int | None:
    """llama-server /props의 n_ctx. 서버가 없거나 형식이 다르면 None."""
    try:
        async with _client(transport) as client:
            resp = await client.get(f"{LLAMA_BASE}/props", timeout=3)
            resp.raise_for_status()
            return resp.json()["default_generation_settings"]["n_ctx"]
    except (httpx.HTTPError, KeyError, TypeError):
        return None


async def count_tokens(
    text: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> tuple[int, bool]:
    """(토큰 수, 정확 여부). 서버가 없으면 문자수//3 추정치에 False."""
    try:
        async with _client(transport) as client:
            resp = await client.post(f"{LLAMA_BASE}/tokenize", json={"content": text}, timeout=10)
            resp.raise_for_status()
            return len(resp.json()["tokens"]), True
    except (httpx.HTTPError, KeyError, TypeError):
        return max(1, len(text) // 3), False


async def is_alive(*, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    try:
        async with _client(transport) as client:
            resp = await client.get(f"{LLAMA_BASE}/health", timeout=3)
            return resp.status_code == 200
    except httpx.HTTPError:
        return False
```

주의: `main.py`의 구 `/api/projects/{id}/chat`이 아직 `gemma.stream_chat`을 옛 시그니처로 부르지만 시그니처가 호환(첫 두 인자 동일)이라 import는 깨지지 않는다. Task 6에서 엔드포인트 자체가 교체된다. `main.py`의 `import httpx`와 `except httpx.HTTPError` 부분은 Task 6에서 제거하므로 여기선 두어도 된다.

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_gemma.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/gemma.py tests/test_gemma.py
git commit -m "feat: gemma client v2 - typed errors, tokenize/props, settle prompts"
```

---

### Task 6: 스레드 기반 chat (문서 선택·오류 구분·부분 저장)

**Files:**
- Modify: `server/main.py` (구 `/api/projects/{id}/chat` 삭제, 신규 엔드포인트)
- Test: `tests/test_chat.py`

**Interfaces:**
- Consumes: Task 4 `get_thread_or_404`, Task 5 gemma 전부
- Produces: `POST /api/threads/{id}/chat` `{message, doc_ids?}` → SSE. `load_chat_context(conn, thread_id, doc_ids) -> (thread, project, docs, history)` — Task 7·8이 재사용. `ChatIn(message, doc_ids)`.
- 동작 계약: user 메시지는 스트림 시작 전 저장. 스트림 실패/중단 시 **받은 청크가 있으면 assistant 부분 저장**. 오류는 unreachable(연결 불가)과 request-failed(HTTP n — 컨텍스트 초과 가능)를 구분한 `{error}` 이벤트.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_chat.py`:

```python
import json

import pytest

from tests.test_projects import make_project
from tests.test_threads import make_thread


def read_events(resp):
    return [line[len("data: "):] for line in resp.iter_lines() if line.startswith("data: ")]


@pytest.fixture
def fake_gemma(monkeypatch):
    from server import gemma

    state = {"system": None, "chunks": ["안녕", "하세요"], "raise_after": None}

    async def fake_stream(system, messages, **kw):
        state["system"] = system
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


def test_chat_404_on_missing_thread(client, fake_gemma):
    assert client.post("/api/threads/999/chat", json={"message": "x"}).status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_chat.py -v`
Expected: FAIL (라우트 부재 404/405)

- [ ] **Step 3: 구현**

`server/main.py` — 구 `chat` 엔드포인트(`/api/projects/{project_id}/chat`)와 구 `ChatIn`, `import httpx` 줄을 삭제하고 아래 추가:

```python
class ChatIn(BaseModel):
    message: Annotated[str, StringConstraints(min_length=1)]
    doc_ids: list[int] | None = None  # None=프로젝트 문서 전체, []=문서 없이


def load_chat_context(conn, thread_id: int, doc_ids: list[int] | None):
    thread = get_thread_or_404(conn, thread_id)
    project = get_project_or_404(conn, thread["project_id"])
    if doc_ids is None:
        rows = conn.execute(
            "SELECT * FROM docs WHERE project_id = ? ORDER BY id", (project["id"],)
        ).fetchall()
    elif not doc_ids:
        rows = []
    else:
        ph = ",".join("?" * len(doc_ids))
        rows = conn.execute(
            f"SELECT * FROM docs WHERE project_id = ? AND id IN ({ph}) ORDER BY id",
            (project["id"], *doc_ids),
        ).fetchall()
    history = conn.execute(
        "SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?",
        (thread_id, HISTORY_LIMIT),
    ).fetchall()
    return thread, project, [dict(r) for r in rows], [dict(h) for h in reversed(history)]


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.post("/api/threads/{thread_id}/chat")
async def chat(thread_id: int, body: ChatIn):
    with db.connect() as conn:
        thread, project, docs, history = load_chat_context(conn, thread_id, body.doc_ids)
    system = gemma.build_system_prompt(project, docs)

    limit = await gemma.context_limit()
    if limit is not None:
        history_text = "".join(m["content"] for m in history)
        used, _ = await gemma.count_tokens(system + history_text + body.message)
        if used > limit - gemma.RESPONSE_RESERVE:
            raise HTTPException(
                413,
                f"컨텍스트 초과 예상 ({used}/{limit} 토큰). 문서 선택을 줄이거나 새 스레드에서 계속하세요.",
            )

    with db.connect() as conn:
        conn.execute(
            "INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', ?)",
            (thread_id, body.message),
        )
    messages = [*history, {"role": "user", "content": body.message}]

    async def event_stream():
        chunks: list[str] = []
        error = None
        try:
            async for delta in gemma.stream_chat(system, messages):
                chunks.append(delta)
                yield _sse({"delta": delta})
        except gemma.GemmaUnreachable:
            error = "llama-server(:8080)에 연결할 수 없어요. Gemma가 떠 있는지 확인하세요."
        except gemma.GemmaRequestFailed as e:
            error = f"Gemma 응답 실패 (HTTP {e.status_code}). 컨텍스트 초과일 수 있어요 — 문서 선택을 줄여보세요."
        finally:
            # 클라이언트 중단(GeneratorExit) 포함: 받은 만큼은 저장해 대화 손실을 막는다
            if chunks:
                with db.connect() as conn:
                    conn.execute(
                        "INSERT INTO messages (thread_id, role, content) VALUES (?, 'assistant', ?)",
                        (thread_id, "".join(chunks)),
                    )
        if error:
            yield _sse({"error": error})
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v`
Expected: PASS 전체

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_chat.py
git commit -m "feat: thread-based chat with doc selection, error kinds, partial save"
```

---

### Task 7: budget 엔드포인트 + 413 가드 테스트

**Files:**
- Modify: `server/main.py`
- Test: `tests/test_budget.py`

**Interfaces:**
- Consumes: Task 6 `load_chat_context`, Task 5 `count_tokens`/`context_limit`
- Produces: `GET /api/threads/{id}/budget?doc_ids=1,2` → `{limit, reserve, total, system_tokens, history_tokens, docs:[{id,title,tokens}], exact}` (계획 2의 게이지 UI가 소비)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_budget.py`:

```python
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


def test_chat_rejected_with_413_when_over_limit(client, monkeypatch):
    from server import gemma

    async def fake_limit(**kw):
        return 1000

    async def fake_count(text, **kw):
        return 5000, True  # 한도 초과 강제

    monkeypatch.setattr(gemma, "context_limit", fake_limit)
    monkeypatch.setattr(gemma, "count_tokens", fake_count)

    p = make_project(client)
    t = make_thread(client, p["id"])
    res = client.post(f"/api/threads/{t['id']}/chat", json={"message": "하이"})
    assert res.status_code == 413
    assert "컨텍스트" in res.json()["detail"]
    # 거부된 요청은 user 메시지도 저장하지 않는다
    assert client.get(f"/api/threads/{t['id']}").json()["messages"] == []
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_budget.py -v`
Expected: budget 2건 FAIL (라우트 부재), 413 테스트는 Task 6 구현으로 이미 PASS일 수 있음 — 그대로 진행

- [ ] **Step 3: 구현**

`server/main.py`에 추가:

```python
@app.get("/api/threads/{thread_id}/budget")
async def thread_budget(thread_id: int, doc_ids: str | None = None):
    ids = [int(x) for x in doc_ids.split(",") if x.strip()] if doc_ids is not None else None
    with db.connect() as conn:
        thread, project, docs, history = load_chat_context(conn, thread_id, ids)
    system = gemma.build_system_prompt(project, docs)

    exact = True
    doc_tokens = []
    for d in docs:
        n, ok = await gemma.count_tokens(d["content"])
        exact = exact and ok
        doc_tokens.append({"id": d["id"], "title": d["title"], "tokens": n})
    system_tokens, ok = await gemma.count_tokens(system)
    exact = exact and ok
    history_tokens = 0
    if history:
        history_tokens, ok = await gemma.count_tokens("".join(m["content"] for m in history))
        exact = exact and ok

    return {
        "limit": await gemma.context_limit(),
        "reserve": gemma.RESPONSE_RESERVE,
        "total": system_tokens + history_tokens,
        "system_tokens": system_tokens,
        "history_tokens": history_tokens,
        "docs": doc_tokens,
        "exact": exact,
    }
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v`
Expected: PASS 전체

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_budget.py
git commit -m "feat: context budget endpoint"
```

---

### Task 8: settle 엔드포인트 (대화 → 문서 초안)

**Files:**
- Modify: `server/main.py`
- Test: `tests/test_settle.py`

**Interfaces:**
- Consumes: Task 5 `build_settle_messages`/`stream_chat`, Task 4 `get_thread_or_404`, Task 3 `get_doc_or_404`
- Produces: `POST /api/threads/{id}/settle` `{target_doc_id?}` → SSE 초안 스트림. **DB에 아무것도 쓰지 않는다** — 저장은 클라이언트가 docs POST/PUT으로. 빈 스레드 422, 타 프로젝트 문서 422.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_settle.py`:

```python
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

    monkeypatch.setattr(gemma, "stream_chat", fake_stream)
    return captured


def _thread_with_chat(client, fake_gemma_state=None):
    p = make_project(client)
    t = make_thread(client, p["id"])
    return p, t


def test_settle_streams_draft_and_writes_nothing(client, fake_settle, monkeypatch):
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
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_settle.py -v`
Expected: FAIL (라우트 부재)

- [ ] **Step 3: 구현**

`server/main.py`에 추가:

```python
class SettleIn(BaseModel):
    target_doc_id: int | None = None


@app.post("/api/threads/{thread_id}/settle")
async def settle(thread_id: int, body: SettleIn):
    with db.connect() as conn:
        thread = get_thread_or_404(conn, thread_id)
        target = None
        if body.target_doc_id is not None:
            target = get_doc_or_404(conn, body.target_doc_id)
            if target["project_id"] != thread["project_id"]:
                raise HTTPException(422, "doc belongs to another project")
        messages = [
            dict(m)
            for m in conn.execute(
                "SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id", (thread_id,)
            ).fetchall()
        ]
    if not messages:
        raise HTTPException(422, "thread has no messages to settle")

    system, prompt_messages = gemma.build_settle_messages(messages, target)

    async def event_stream():
        try:
            async for delta in gemma.stream_chat(system, prompt_messages):
                yield _sse({"delta": delta})
        except gemma.GemmaUnreachable:
            yield _sse({"error": "llama-server(:8080)에 연결할 수 없어요. Gemma가 떠 있는지 확인하세요."})
        except gemma.GemmaRequestFailed as e:
            yield _sse({"error": f"Gemma 응답 실패 (HTTP {e.status_code})."})
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest -v`
Expected: PASS 전체

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_settle.py
git commit -m "feat: settle endpoint - conversation to doc draft via gemma"
```

---

### Task 9: 문서 갱신 + 전체 검증

**Files:**
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: 전 태스크의 최종 API 표면
- Produces: 계획 2·3 작업자가 읽을 최신 문서

- [ ] **Step 1: CLAUDE.md 갱신**

`CLAUDE.md`의 아키텍처 섹션을 현행화 — 다음 내용을 반영해 다시 쓴다:

```markdown
## 아키텍처

- `server/` — FastAPI 백엔드. SQLite(`data/atlas.db`, `ATLAS_DB`로 오버라이드)에
  프로젝트/문서/스레드/메시지 저장 (스키마 v2, `PRAGMA user_version`).
  Gemma 챗은 llama-server(:8080, `ATLAS_LLAMA_BASE`)의 OpenAI 호환 API로 프록시 (SSE 스트리밍).
- 문서 kind: `idea`(기획) / `research`(조사 리포트) / `world`(세계관 문서) / `note`(잡메모).
  채팅 요청의 `doc_ids`로 이번 대화에 물릴 문서를 선택한다 (생략 시 전체).
- 대화는 프로젝트당 다중 스레드. `POST /api/threads/{id}/settle`이 대화를 문서 초안으로
  정리해 스트리밍하고(저장은 클라이언트 몫), `GET /api/threads/{id}/budget`이 컨텍스트
  예산을 보고한다 (llama `/tokenize`·`/props` 기반, 서버 부재 시 추정치).
- `web/` — 구 바닐라 UI (v2 API와 불일치, React+Vite로 대체 예정 — 계획 2).
- 테스트: `uv run pytest` — llama-server를 절대 직접 치지 않는다 (모킹/MockTransport).
```

- [ ] **Step 2: README.md 갱신**

"시작" 섹션 아래에 추가:

```markdown
## 테스트

```bash
uv run pytest
```

llama-server 없이 전부 돈다 (Gemma 연동은 모킹).
```

- [ ] **Step 3: 전체 검증**

```bash
uv run pytest -v
```
Expected: 전체 PASS. 이어서 수동 스모크 (llama-server가 떠 있으면):

```bash
uv run uvicorn server.main:app --port 8787 &
curl -s http://127.0.0.1:8787/api/health
curl -s -X POST http://127.0.0.1:8787/api/projects -H 'Content-Type: application/json' -d '{"name": "스모크"}'
```
Expected: `{"ok":true,...}`, 201 프로젝트 JSON. 확인 후 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: schema v2 architecture and test instructions"
```

---

## 후속 계획 (이 문서 범위 밖)

- **계획 2 — React+Vite UI**: TS strict, 마크다운 렌더링(문서+챗), 스레드 UI, 문서 체크박스+예산 게이지, 정착 검토·수정 플로우, 문서 편집기. FastAPI가 `web/dist` 서빙. Vite dev 포트는 5173 (이 머신 점유 포트와 안 겹침).
- **계획 3 — 스킬**: `ideate` 스킬 신설(기획 게이트 4층: 동기 보존·욕구 실재성+경량 웹 확인·문제-해결 정합·검증가능성), `research` 스킬 개정(idea 문서 기반 각도 + 5지 스코어카드: Uniqueness/Impact/타깃×수요/제품 정합/타이밍 + go/pivot/no-go 판정, 기준별 필수 수집 항목).
