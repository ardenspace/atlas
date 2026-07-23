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
