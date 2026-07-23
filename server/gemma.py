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


def _merge_consecutive_roles(messages: list[dict]) -> list[dict]:
    """Gemma 챗 템플릿은 user/assistant 교대를 강제한다 — 연속 같은 role은 하나로 병합."""
    merged: list[dict] = []
    for m in messages:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n\n" + m["content"]
        else:
            merged.append({"role": m["role"], "content": m["content"]})
    return merged


async def stream_chat(
    system: str, messages: list[dict], *, transport: httpx.AsyncBaseTransport | None = None
) -> AsyncIterator[str]:
    payload = {
        "messages": [{"role": "system", "content": system}, *_merge_consecutive_roles(messages)],
        "stream": True,
    }
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
                    try:
                        delta = json.loads(data)["choices"][0]["delta"]
                    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                        continue  # 깨진 SSE 라인은 건너뛰고 스트림은 유지
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
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return None


async def count_tokens(
    text: str, *, transport: httpx.AsyncBaseTransport | None = None
) -> tuple[int, bool]:
    """(토큰 수, 정확 여부). 서버가 없으면 추정치에 False (Gemma 토크나이저 한국어 기준 ~1.5자=1토큰)."""
    try:
        async with _client(transport) as client:
            resp = await client.post(f"{LLAMA_BASE}/tokenize", json={"content": text}, timeout=10)
            resp.raise_for_status()
            return len(resp.json()["tokens"]), True
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return max(1, int(len(text) / 1.5)), False


async def is_alive(*, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    try:
        async with _client(transport) as client:
            resp = await client.get(f"{LLAMA_BASE}/health", timeout=3)
            return resp.status_code == 200
    except httpx.HTTPError:
        return False
