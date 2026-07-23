"""atlas — market research + worldbuilding companion.

Run: uv run uvicorn server.main:app --host 0.0.0.0 --port 8787
"""
import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, StringConstraints

from . import db, gemma


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(title="atlas", lifespan=lifespan)

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

# 대화 컨텍스트에 넣는 최근 메시지 수 — Gemma 컨텍스트 한도 보호용
HISTORY_LIMIT = 30


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


class ChatIn(BaseModel):
    message: str


def slugify(name: str) -> str:
    return "-".join(name.lower().split())


@app.get("/api/health")
async def health():
    return {"ok": True, "gemma": await gemma.is_alive()}


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
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)


def get_project_or_404(conn, project_id: int) -> dict:
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "project not found")
    return dict(row)


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


@app.post("/api/projects/{project_id}/docs", status_code=201)
def add_doc(project_id: int, doc: DocIn):
    with db.connect() as conn:
        get_project_or_404(conn, project_id)
        cur = conn.execute(
            "INSERT INTO docs (project_id, kind, title, content) VALUES (?, ?, ?, ?)",
            (project_id, doc.kind, doc.title, doc.content),
        )
    return {"id": cur.lastrowid}


@app.get("/api/projects/{project_id}/docs/{doc_id}")
def get_doc(project_id: int, doc_id: int):
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM docs WHERE id = ? AND project_id = ?", (doc_id, project_id)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "doc not found")
    return dict(row)


@app.post("/api/projects/{project_id}/chat")
async def chat(project_id: int, body: ChatIn):
    with db.connect() as conn:
        project = get_project_or_404(conn, project_id)
        docs = conn.execute(
            "SELECT kind, title, content FROM docs WHERE project_id = ? ORDER BY id",
            (project_id,),
        ).fetchall()
        history = conn.execute(
            "SELECT role, content FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT ?",
            (project_id, HISTORY_LIMIT),
        ).fetchall()
        conn.execute(
            "INSERT INTO messages (project_id, role, content) VALUES (?, 'user', ?)",
            (project_id, body.message),
        )

    system = gemma.build_system_prompt(project, [dict(d) for d in docs])
    messages = [{"role": r["role"], "content": r["content"]} for r in reversed(history)]
    messages.append({"role": "user", "content": body.message})

    async def event_stream():
        chunks = []
        try:
            async for delta in gemma.stream_chat(system, messages):
                chunks.append(delta)
                yield f"data: {json.dumps({'delta': delta})}\n\n"
        except httpx.HTTPError:
            yield f"data: {json.dumps({'error': 'llama-server(:8080)에 연결할 수 없어요. Gemma가 떠 있는지 확인하세요.'})}\n\n"
            return
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO messages (project_id, role, content) VALUES (?, 'assistant', ?)",
                (project_id, "".join(chunks)),
            )
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
