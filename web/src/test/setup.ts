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

// jsdom엔 matchMedia가 없다 — __vpMobile 플래그 기반 모킹 (기본: 데스크톱)
// useIsMobile이 쓰는 쿼리 문자열과 정확히 일치할 때만 모바일로 취급한다 (max-width 포함 여부로만
// 판별하면 나중에 두 번째 브레이크포인트가 생겼을 때 그것도 모바일로 잘못 응답하게 된다)
const MOBILE_QUERY = '(max-width: 768px)'
beforeEach(() => {
  ;(globalThis as any).__vpMobile = false
})
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    get matches() {
      return query === MOBILE_QUERY && (globalThis as any).__vpMobile === true
    },
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
    addListener: () => {},
    removeListener: () => {},
  }),
})

// 모킹 안 된 요청은 즉시 실패 — NO LIVE 강제
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
