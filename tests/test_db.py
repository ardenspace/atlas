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


def test_migration_is_atomic_on_error(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    raw = sqlite3.connect(path)
    raw.executescript(V1_SCHEMA)
    raw.execute("INSERT INTO projects (slug, name) VALUES ('p', 'P')")
    raw.execute("INSERT INTO docs (project_id, kind, title, content) VALUES (1, 'research', '리포트', '본문')")
    raw.commit()
    raw.close()

    monkeypatch.setenv("ATLAS_DB", str(path))
    from server import db

    # docs를 rename한 뒤 깨진 SQL — 마이그레이션이 원자적이면 rename까지 롤백돼야 한다
    monkeypatch.setattr(db, "_MIGRATE_V1", "ALTER TABLE docs RENAME TO docs_v1;\nINVALID SQL STATEMENT;")
    with pytest.raises(sqlite3.OperationalError):
        db.init()

    conn = sqlite3.connect(path)
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "docs" in tables and "docs_v1" not in tables  # rename 롤백됨
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 0  # 버전 그대로
    finally:
        conn.close()
