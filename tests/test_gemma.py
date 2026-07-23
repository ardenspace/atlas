import json

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
async def test_stream_chat_merges_consecutive_same_role_messages():
    # 스트림 실패로 히스토리에 user가 연속으로 남아도 Gemma 템플릿(role 교대 강제)이 안 깨져야 한다
    captured = {}

    def handler(req):
        captured["payload"] = json.loads(req.content)
        return httpx.Response(200, content=SSE)

    msgs = [
        {"role": "user", "content": "첫 질문"},
        {"role": "user", "content": "재시도"},
        {"role": "assistant", "content": "답"},
    ]
    [d async for d in gemma.stream_chat("sys", msgs, transport=httpx.MockTransport(handler))]
    sent = captured["payload"]["messages"]
    assert [m["role"] for m in sent] == ["system", "user", "assistant"]
    assert "첫 질문" in sent[1]["content"] and "재시도" in sent[1]["content"]


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
async def test_context_limit_none_on_non_json_body():
    # 200이지만 본문이 JSON이 아님 (프록시/터널 오류 페이지) → 500이 아니라 None으로 강등
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=b"<html>error</html>"))
    assert await gemma.context_limit(transport=transport) is None


@pytest.mark.anyio
async def test_count_tokens_estimates_on_non_json_body():
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=b"<html>error</html>"))
    n, exact = await gemma.count_tokens("가" * 30, transport=transport)
    assert n == 20 and exact is False


@pytest.mark.anyio
async def test_stream_chat_skips_malformed_sse_lines():
    # 정상 delta → 깨진 json → data: null(JSON은 유효하나 TypeError) → 정상 delta
    mixed = (
        b'data: {"choices":[{"delta":{"content":"\xec\x95\x88"}}]}\n\n'
        b"data: not json\n\n"
        b"data: null\n\n"
        b'data: {"choices":[{"delta":{"content":"\xeb\x85\x95"}}]}\n\n'
        b"data: [DONE]\n\n"
    )
    transport = httpx.MockTransport(lambda req: httpx.Response(200, content=mixed))
    out = [d async for d in gemma.stream_chat("sys", [], transport=transport)]
    assert out == ["안", "녕"]


@pytest.mark.anyio
async def test_count_tokens_estimates_when_unreachable():
    def boom(req):
        raise httpx.ConnectError("refused", request=req)

    n, exact = await gemma.count_tokens("가" * 30, transport=httpx.MockTransport(boom))
    assert n == 20 and exact is False


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
