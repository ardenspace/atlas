import { http, HttpResponse } from 'msw'
import { server, sseChunkedResponse, sseResponse } from '../test/msw'
import { ApiError } from './client'
import { streamSSE } from './sse'

function collect() {
  const deltas: string[] = []
  const errors: string[] = []
  return {
    deltas,
    errors,
    handlers: {
      onDelta: (t: string) => deltas.push(t),
      onError: (m: string) => errors.push(m),
    },
  }
}

test('청크 경계에 걸린 이벤트를 재조립한다', async () => {
  server.use(
    http.post('/api/threads/1/chat', () =>
      sseChunkedResponse(['data: {"del', 'ta": "안"}\n\ndata: {"delta": "녕"}\n\n', 'data: [DONE]\n\n']),
    ),
  )
  const c = collect()
  await streamSSE('/api/threads/1/chat', { message: 'hi' }, c.handlers)
  expect(c.deltas).toEqual(['안', '녕'])
  expect(c.errors).toEqual([])
})

test('error 이벤트를 전달하고 [DONE] 이후는 읽지 않는다', async () => {
  server.use(
    http.post('/api/threads/1/chat', () =>
      sseChunkedResponse([
        'data: {"delta": "부분"}\n\n',
        'data: {"error": "Gemma 응답 실패"}\n\n',
        'data: [DONE]\n\n',
        'data: {"delta": "유령"}\n\n',
      ]),
    ),
  )
  const c = collect()
  await streamSSE('/api/threads/1/chat', { message: 'hi' }, c.handlers)
  expect(c.deltas).toEqual(['부분'])
  expect(c.errors).toEqual(['Gemma 응답 실패'])
})

test('손상된 data 라인은 건너뛴다', async () => {
  server.use(
    http.post('/api/threads/1/settle', () =>
      sseChunkedResponse(['data: {"delta": "a"}\n\ndata: not json\n\ndata: {"delta": "b"}\n\ndata: [DONE]\n\n']),
    ),
  )
  const c = collect()
  await streamSSE('/api/threads/1/settle', {}, c.handlers)
  expect(c.deltas).toEqual(['a', 'b'])
})

test('HTTP 에러는 detail을 담은 ApiError로 던진다 (스트림 시작 전)', async () => {
  server.use(
    http.post('/api/threads/1/chat', () =>
      HttpResponse.json({ detail: '컨텍스트 초과 예상 (9000/8192 토큰).' }, { status: 413 }),
    ),
  )
  const c = collect()
  const err = (await streamSSE('/api/threads/1/chat', { message: 'hi' }, c.handlers).catch(
    (e: unknown) => e,
  )) as ApiError
  expect(err).toBeInstanceOf(ApiError)
  expect(err.status).toBe(413)
  expect(err.detail).toContain('컨텍스트 초과')
  expect(c.deltas).toEqual([])
})

test('abort되면 조용히 resolve한다', async () => {
  server.use(
    http.post('/api/threads/1/chat', () => {
      const enc = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode('data: {"delta": "첫"}\n\n'))
          // 닫지 않음 — 무한 스트림 흉내
        },
      })
      return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }),
  )
  const ac = new AbortController()
  const c = collect()
  const done = streamSSE('/api/threads/1/chat', { message: 'hi' }, c.handlers, ac.signal)
  await vi.waitFor(() => expect(c.deltas).toEqual(['첫']))
  ac.abort()
  await expect(done).resolves.toBeUndefined()
})

test('sseResponse 헬퍼(단일 본문)도 파싱된다', async () => {
  server.use(
    http.post('/api/threads/1/chat', () => sseResponse([{ delta: 'ㄱ' }, { delta: 'ㄴ' }, '[DONE]']),
    ),
  )
  const c = collect()
  await streamSSE('/api/threads/1/chat', { message: 'hi' }, c.handlers)
  expect(c.deltas).toEqual(['ㄱ', 'ㄴ'])
})
