import '@testing-library/jest-dom/vitest'
import { server } from './msw'

// jsdom에는 fetch가 없어 Node(undici) 전역 fetch를 쓰는데, 이는 상대 URL을 못 받는다.
// 앱 코드는 '/api/…' 상대 경로를 쓰므로 테스트에서만 절대 URL로 승격한다.
const origFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/')) {
    return origFetch(new URL(input, 'http://localhost').href, init)
  }
  return origFetch(input, init)
}) as typeof fetch

// 모킹 안 된 요청은 즉시 실패 — NO LIVE 강제
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
