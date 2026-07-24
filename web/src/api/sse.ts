import { parseError } from './client'

export interface SSEHandlers {
  onDelta: (text: string) => void
  onError: (message: string) => void
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/**
 * 서버 SSE(`data: {"delta"|"error"}` / `data: [DONE]`)를 끝까지 읽는다.
 * - HTTP 에러(4xx/5xx)는 스트림 시작 전 ApiError로 throw
 * - abort는 조용히 resolve (부분 저장은 서버 몫)
 * - 손상된 data 라인은 건너뛴다
 */
export async function streamSSE(
  url: string,
  body: unknown,
  handlers: SSEHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (isAbort(e)) return
    throw e
  }
  if (!res.ok) throw await parseError(res)
  if (!res.body) return

  const reader = res.body.getReader()
  // abort 시 pending read()가 reject되지 않는 런타임(MSW 모킹 등)이 있어,
  // 시그널에 직접 걸어 reader를 취소한다 → read()가 {done:true}로 풀려 조용히 resolve.
  const onAbort = () => void reader.cancel().catch(() => {})
  if (signal) {
    if (signal.aborted) {
      reader.releaseLock()
      return
    }
    signal.addEventListener('abort', onAbort)
  }
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (!event.startsWith('data: ')) continue
        const payload = event.slice('data: '.length)
        if (payload === '[DONE]') return
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (parsed !== null && typeof parsed === 'object') {
          const obj = parsed as { delta?: unknown; error?: unknown }
          if (typeof obj.delta === 'string') handlers.onDelta(obj.delta)
          else if (typeof obj.error === 'string') handlers.onError(obj.error)
        }
      }
    }
  } catch (e) {
    if (isAbort(e)) return
    throw e
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
