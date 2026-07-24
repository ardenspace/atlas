"""atlas — market research + worldbuilding companion.

Run: uv run uvicorn server.main:app --host 0.0.0.0 --port 8787
"""
import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, StringConstraints

from . import db, gemma


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    yield


app = FastAPI(title="atlas", lifespan=lifespan)

DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"

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


class DocPatch(BaseModel):
    kind: Literal["idea", "research", "world", "note"] | None = None
    title: Name | None = None
    content: str | None = None


class ThreadIn(BaseModel):
    title: Name


class ThreadPatch(BaseModel):
    title: Name | None = None
    archived: bool | None = None


class ChatIn(BaseModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    doc_ids: list[int] | None = None  # None=프로젝트 문서 전체, []=문서 없이


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
            raise HTTPException(409, "project with same slug exists") from None
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
            raise HTTPException(409, "project with same slug exists") from None
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
    history = [
        dict(h)
        for h in reversed(
            conn.execute(
                "SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?",
                (thread_id, HISTORY_LIMIT),
            ).fetchall()
        )
    ]
    # 잘린 창이 assistant로 시작하면 버린다 — Gemma 템플릿은 첫 턴이 user일 것을 강제
    while history and history[0]["role"] == "assistant":
        history.pop(0)
    return thread, project, [dict(r) for r in rows], history


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _gemma_error_message(e: Exception) -> str:
    """chat·settle 공용 사용자 대면 에러 문구 — 문구는 여기 한 곳에만 산다."""
    if isinstance(e, gemma.GemmaRequestFailed):
        return (
            f"Gemma 응답 실패 (HTTP {e.status_code}). 컨텍스트 초과일 수 있어요 — "
            "문서 선택이나 스레드 길이를 줄여보세요."
        )
    return "llama-server(:8080)에 연결할 수 없어요. Gemma가 떠 있는지 확인하세요."


@app.post("/api/threads/{thread_id}/chat")
async def chat(thread_id: int, body: ChatIn):
    with db.connect() as conn:
        _thread, project, docs, history = load_chat_context(conn, thread_id, body.doc_ids)
    system = gemma.build_system_prompt(project, docs)

    limit = await gemma.context_limit()
    if limit is not None:
        history_text = "".join(m["content"] for m in history)
        used, _ = await gemma.count_tokens(system + history_text + body.message)
        # 원문 토큰에 더해 메시지당 챗 템플릿 래퍼 오버헤드(system + 히스토리 + 새 user 메시지)
        used += gemma.TEMPLATE_OVERHEAD_PER_MSG * (len(history) + 2)
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
        except (gemma.GemmaUnreachable, gemma.GemmaRequestFailed) as e:
            error = _gemma_error_message(e)
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

    limit = await gemma.context_limit()
    if limit is not None:
        used, _ = await gemma.count_tokens(system + prompt_messages[0]["content"])
        # 메시지당 챗 템플릿 래퍼 오버헤드 (system + 대화 기록 메시지 = 2)
        used += gemma.TEMPLATE_OVERHEAD_PER_MSG * 2
        if used > limit - gemma.RESPONSE_RESERVE:
            raise HTTPException(
                413,
                f"컨텍스트 초과 예상 ({used}/{limit} 토큰) — 스레드가 너무 길어 통째로 정착할 수 없습니다.",
            )

    async def event_stream():
        try:
            async for delta in gemma.stream_chat(system, prompt_messages):
                yield _sse({"delta": delta})
        except (gemma.GemmaUnreachable, gemma.GemmaRequestFailed) as e:
            yield _sse({"error": _gemma_error_message(e)})
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/threads/{thread_id}/budget")
async def thread_budget(thread_id: int, doc_ids: str | None = None):
    # 빈 문자열 → [] (문서 없이), 파라미터 생략 → None (전체 문서) — ChatIn.doc_ids 시맨틱과 일치
    try:
        ids = [int(x) for x in doc_ids.split(",") if x.strip()] if doc_ids is not None else None
    except ValueError:
        raise HTTPException(400, "doc_ids must be comma-separated integers") from None
    with db.connect() as conn:
        _thread, project, docs, history = load_chat_context(conn, thread_id, ids)
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


# 빌드된 프론트(web/dist) 서빙 — dist가 아예 없으면(빌드 전) starlette check_config가 첫 비-API
# 요청에서 RuntimeError→500 (서버 기동·/api/*는 정상). dist가 있고 경로만 없으면 404.
# 마운트는 라우트 테이블 마지막에 매칭되므로 /api/*를 가리지 않는다.
app.mount("/", StaticFiles(directory=DIST_DIR, html=True, check_dir=False), name="web")
