"""Client for the local llama-server (Gemma) OpenAI-compatible API."""
import json
from typing import AsyncIterator

import httpx

LLAMA_BASE = "http://127.0.0.1:8080"

SYSTEM_TEMPLATE = """당신은 마케팅 프로젝트의 콘텐츠 세계관을 함께 짓는 기획 파트너다. \
아래는 이 프로젝트의 기획 메모, 사전 조사 리포트, 지금까지 쌓인 세계관 문서다. \
이 자료들에 근거해 대화하되, 자료에 없는 것은 추측임을 밝혀라. \
사용자와 함께 아이디어를 발전시키는 것이 목표이므로, 결론을 서두르지 말고 \
선택지와 그 트레이드오프를 보여줘라. 한국어로 대화한다.

# 프로젝트: {name}

## 기획 메모
{brief}

{docs}"""


def build_system_prompt(project: dict, docs: list[dict]) -> str:
    doc_sections = []
    for d in docs:
        label = {"research": "조사 리포트", "world": "세계관 문서", "note": "노트"}[d["kind"]]
        doc_sections.append(f"## [{label}] {d['title']}\n{d['content']}")
    return SYSTEM_TEMPLATE.format(
        name=project["name"],
        brief=project["brief"] or "(아직 없음)",
        docs="\n\n".join(doc_sections) or "(아직 문서 없음)",
    )


async def stream_chat(system: str, messages: list[dict]) -> AsyncIterator[str]:
    """Yield content deltas from llama-server. Raises httpx.HTTPError if unreachable."""
    payload = {
        "messages": [{"role": "system", "content": system}, *messages],
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=5)) as client:
        async with client.stream(
            "POST", f"{LLAMA_BASE}/v1/chat/completions", json=payload
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[len("data: "):]
                if data.strip() == "[DONE]":
                    break
                delta = json.loads(data)["choices"][0]["delta"]
                if content := delta.get("content"):
                    yield content


async def is_alive() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{LLAMA_BASE}/health")
            return resp.status_code == 200
    except httpx.HTTPError:
        return False
