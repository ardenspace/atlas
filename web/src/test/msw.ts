import { HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const server = setupServer()

const SSE_HEADERS = { 'Content-Type': 'text/event-stream' }

/** 이벤트 배열을 SSE 본문 한 덩어리로 응답 (컴포넌트 테스트용) */
export function sseResponse(events: Array<Record<string, unknown> | '[DONE]'>) {
  const body = events
    .map((e) => `data: ${e === '[DONE]' ? '[DONE]' : JSON.stringify(e)}\n\n`)
    .join('')
  return new HttpResponse(body, { headers: SSE_HEADERS })
}

/** 원시 문자열 청크들을 그대로 스트림으로 흘림 (파서 경계 테스트용) */
export function sseChunkedResponse(chunks: string[]) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const ch of chunks) controller.enqueue(enc.encode(ch))
      controller.close()
    },
  })
  return new HttpResponse(stream, { headers: SSE_HEADERS })
}
