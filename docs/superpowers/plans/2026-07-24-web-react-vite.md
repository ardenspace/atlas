# 계획 2 — web/ React+Vite 재작성 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구 바닐라 `web/`을 React+Vite+TS strict UI(3판 워크스페이스: 사이드바/챗/문서 패널 + 문서·정착 오버레이)로 전면 대체하고, FastAPI가 `web/dist`를 서빙하게 한다.

**Architecture:** 라우터 없는 단일 화면. `App.tsx`가 선택 상태(프로젝트/스레드/문서 체크/오버레이)를 들고, 컴포넌트는 TanStack Query 훅으로 서버 상태를 직접 소비한다. SSE(챗·정착)는 공용 파서 유틸 하나가 담당. 테스트는 vitest+RTL+MSW로 전 API를 모킹한다.

**Tech Stack:** React 19 + TypeScript strict, Vite, TanStack Query v5, react-markdown + remark-gfm, 순수 CSS. 테스트: vitest, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom, MSW v2.

**Spec:** `docs/superpowers/specs/2026-07-24-web-react-vite-design.md`
**API 계약(변경 금지):** `docs/superpowers/plans/2026-07-23-backend-rework.md`의 "## 최종 API 표면"

## 프로세스 (계획 1과 동일한 SDD 루프)

- 브랜치: main에서 `web-rewrite` 신규. 태스크마다 1커밋.
- 루프: **opus 서브에이전트가 구현+커밋 → fresh fable이 커밋 리뷰 → 수정 필요 시 리뷰한 fable이 고침 → fresh fable 재리뷰**. 태스크 결과를 `.superpowers/sdd/progress.md`에 "plan 2 (web-rewrite)" 섹션으로 원장 기록.
- 서브에이전트에는 해당 태스크 섹션 전문 + "Global Constraints" 섹션을 브리프로 전달한다.
- 완주 후 최종 whole-branch 리뷰(fresh fable) → 사용자 머지 결정.

## Global Constraints

- **TS strict**: Vite react-ts 템플릿의 strict 설정을 절대 완화하지 않는다.
- **런타임 의존성 화이트리스트**: react, react-dom, @tanstack/react-query, react-markdown, remark-gfm — 이 외 추가 금지. dev 의존성은 Task 1의 목록이 전부.
- **포트**: Vite dev 5173(`strictPort: true`), `/api` 프록시 대상 8787. **8080(Gemma)은 어떤 파일에서도 참조 금지.**
- **API 계약 동결**: 서버 수정은 Task 10의 dist 마운트 교체가 유일. 그 외 서버를 고치고 싶어지면 멈추고 사용자에게 묻는다.
- **NO LIVE**: 테스트는 MSW `onUnhandledRequest: 'error'`로 모킹 누락 시 즉시 실패한다. 어떤 테스트/에이전트도 uvicorn·vite dev 서버를 띄우거나 8787/8080에 접속하지 않는다. 실행 확인은 사용자가 수동으로 한다.
- **커밋 게이트**: 매 커밋 전 `cd web && npm run typecheck && npm test` green (Task 10은 `uv run pytest`도). 백엔드 62개 테스트는 Task 10 전까지 건드릴 일 자체가 없다.
- 에러 표시는 서버가 주는 한국어 `detail` 문구를 그대로 쓴다 — 프론트에서 재작성하지 않는다.

## 파일 구조 (최종)

```
web/
  package.json  vite.config.ts  tsconfig*.json  index.html  eslint.config.js  .gitignore(템플릿)
  src/
    main.tsx            — 엔트리 (QueryClientProvider)
    App.tsx             — 선택 상태 + 3판 배치 + 오버레이 스위치
    styles.css          — 전체 스타일 (다크 팔레트 계승)
    api/
      types.ts          — 서버 응답 타입 (main.py 응답 형태 그대로)
      client.ts         — api<T>() fetch 래퍼 + ApiError
      hooks.ts          — TanStack Query 훅 (조회 6 + 변이 9)
      sse.ts            — streamSSE() 공용 SSE 파서
    components/
      Sidebar.tsx  ChatPane.tsx  Markdown.tsx
      DocsPanel.tsx  BudgetGauge.tsx  DocEditor.tsx  SettleOverlay.tsx
    test/
      setup.ts          — jest-dom, MSW 수명주기, fetch 상대경로 심
      msw.ts            — setupServer + SSE 응답 헬퍼
      utils.tsx         — renderWithClient()
      fixtures.ts       — makeProject() 등 픽스처 팩토리
    (테스트는 대상 옆에 콜로케이트: src/api/client.test.ts, src/components/Sidebar.test.tsx …)
server/main.py          — Task 10에서만: /static·GET / → web/dist 마운트 교체
tests/test_static.py    — Task 10 백엔드 테스트
CLAUDE.md, README.md    — Task 10 문서 갱신
```

서버 응답 형태 참조 (main.py에서 확정, types.ts가 그대로 따른다):

- `GET /api/projects/{id}` → `{project, docs: [{id,kind,title,created_at,updated_at}], threads: [{id,title,archived,created_at}]}` — **archived는 0/1 정수**
- `GET /api/threads/{id}` → `{thread: {id,project_id,title,archived,created_at}, messages: [{id,role,content,created_at}]}`
- `GET /api/threads/{id}/budget` → `{limit: number|null, reserve, total, system_tokens, history_tokens, docs: [{id,title,tokens}], exact}` — total = system+history (docs 토큰은 system에 포함된 내역)
- 에러 응답 본문: `{"detail": "..."}` (FastAPI HTTPException)
- SSE: `data: {"delta": "..."}\n\n` / `data: {"error": "..."}\n\n` / `data: [DONE]\n\n`

---

### Task 1: Vite 스캐폴드 + 테스트 인프라

**Files:**
- Delete: `web/index.html`, `web/app.js`, `web/style.css` (구 바닐라)
- Create: Vite react-ts 템플릿 일체 (`web/package.json`, `web/vite.config.ts`, `web/tsconfig*.json`, `web/index.html`, `web/src/…`)
- Create: `web/src/styles.css`, `web/src/test/setup.ts`, `web/src/test/msw.ts`, `web/src/test/utils.tsx`
- Test: `web/src/App.test.tsx` (스모크 — Task 9에서 진짜 App 테스트로 대체됨)

**Interfaces:**
- Produces: `npm run dev`(5173)/`build`/`test`/`typecheck` 스크립트, MSW `server`·`sseResponse`·`sseChunkedResponse`(test/msw.ts), `renderWithClient()`(test/utils.tsx). 이후 모든 태스크가 이 인프라 위에서 돈다.

- [ ] **Step 1: 구 파일 제거 + 템플릿 생성**

```bash
cd /Users/arden/code/atlas
git rm web/index.html web/app.js web/style.css
cd web && npm create vite@latest . -- --template react-ts
npm install
npm install @tanstack/react-query react-markdown remark-gfm
npm install -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom msw
```

템플릿 잔재 정리 (우리 구조에 없는 것):

```bash
rm -rf src/assets public src/App.css src/index.css
```

주의: 템플릿이 만든 `web/.gitignore`에 `node_modules`·`dist`가 이미 있는지 확인한다(있으면 그대로 둠 — 스펙의 ".gitignore 추가" 요건을 이 파일이 충족). `web/eslint.config.js`와 템플릿 tsconfig(strict)는 그대로 둔다.

- [ ] **Step 2: 설정 파일 작성**

`web/vite.config.ts` (전체 교체):

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
```

`web/package.json`의 scripts를 다음으로 (템플릿 기존 키 유지 + 추가):

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "typecheck": "tsc -b"
}
```

`web/tsconfig.app.json`의 `compilerOptions`에 추가 (strict 관련 기존 값은 건드리지 않는다):

```json
"types": ["vitest/globals", "@testing-library/jest-dom"]
```

`web/index.html` (전체 교체):

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>atlas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: 엔트리 + 앱 셸 + 스타일**

`web/src/main.tsx` (전체 교체):

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
```

`web/src/App.tsx` (전체 교체 — Task 9에서 진짜 배선으로 재작성될 임시 셸):

```tsx
export default function App() {
  return (
    <div className="app">
      <p className="placeholder">atlas 로딩됨</p>
    </div>
  )
}
```

`web/src/styles.css` (신규 — 이 프로젝트의 전체 스타일. 이후 태스크는 여기 정의된 클래스명을 그대로 쓴다):

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: #14151a; --panel: #1d1f26; --line: #2c2f3a;
  --text: #e8e8ea; --dim: #8b8e98; --accent: #6ea8fe;
  --danger: #f87171; --ok: #4ade80; --warn: #fbbf24;
}
html, body, #root { height: 100%; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, "Apple SD Gothic Neo", sans-serif; font-size: 14px;
}
button { font: inherit; cursor: pointer; }
.dim { color: var(--dim); }
.placeholder { color: var(--dim); margin: auto; }

/* ---- 3판 배치 ---- */
.app { display: grid; grid-template-columns: 240px 1fr 280px; height: 100%; }

/* ---- 사이드바 ---- */
.sidebar {
  background: var(--panel); border-right: 1px solid var(--line);
  padding: 16px; overflow-y: auto;
}
.sidebar header { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
.sidebar h1 { font-size: 18px; letter-spacing: 1px; }
.status { font-size: 10px; color: var(--dim); }
.status.up { color: var(--ok); }
.status.down { color: var(--danger); }
.section-head { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 6px; }
.section-head h2 { font-size: 12px; color: var(--dim); text-transform: uppercase; }
.section-head button {
  background: none; border: 1px solid var(--line); color: var(--dim);
  border-radius: 4px; width: 20px; height: 20px; line-height: 1;
}
.section-head button:hover { color: var(--accent); border-color: var(--accent); }
.sidebar ul { list-style: none; }
.sidebar li { display: flex; align-items: center; border-radius: 6px; }
.sidebar li:hover { background: var(--line); }
.sidebar li.active { background: var(--line); }
.sidebar li.active .row-main { color: var(--accent); }
.sidebar li.archived .row-main { color: var(--dim); text-decoration: line-through; }
.row-main {
  flex: 1; text-align: left; background: none; border: none; color: inherit;
  padding: 6px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row-actions { display: none; gap: 2px; padding-right: 4px; }
.sidebar li:hover .row-actions, .sidebar li.active .row-actions { display: inline-flex; }
.row-actions button { background: none; border: none; color: var(--dim); font-size: 11px; padding: 2px; }
.row-actions button:hover { color: var(--text); }

/* ---- 챗 ---- */
.chat { display: flex; flex-direction: column; min-width: 0; }
.chat-head { padding: 12px 24px; border-bottom: 1px solid var(--line); }
.chat-head h2 { font-size: 15px; }
.chat-log {
  flex: 1; overflow-y: auto; padding: 24px;
  display: flex; flex-direction: column; gap: 12px;
}
.msg { max-width: 72ch; padding: 10px 14px; border-radius: 12px; line-height: 1.55; }
.msg.user { align-self: flex-end; background: #2b3a55; white-space: pre-wrap; }
.msg.assistant { align-self: flex-start; background: var(--panel); }
.msg.error { align-self: center; color: var(--danger); background: none; }
.msg.streaming::after { content: "▍"; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: 0; } }
.chat-form { display: flex; gap: 8px; padding: 16px 24px; border-top: 1px solid var(--line); }
.chat-form textarea {
  flex: 1; resize: none; background: var(--panel); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px; padding: 10px; font: inherit;
}
.chat-form textarea:focus { outline: none; border-color: var(--accent); }
.chat-form button {
  background: var(--accent); border: none; border-radius: 8px;
  padding: 0 20px; color: #10131a; font-weight: 600;
}
.chat-form button:disabled, .chat-form textarea:disabled { opacity: 0.4; }

/* ---- 문서 패널 ---- */
.docs-panel {
  background: var(--panel); border-left: 1px solid var(--line);
  padding: 16px; display: flex; flex-direction: column; overflow-y: auto;
}
.doc-list { list-style: none; flex: 1; }
.doc-list li { display: flex; align-items: center; gap: 6px; padding: 5px 2px; }
.kind {
  font-size: 10px; padding: 1px 5px; border-radius: 4px;
  border: 1px solid var(--line); color: var(--dim); flex-shrink: 0;
}
.kind-idea { color: #c084fc; border-color: #c084fc; }
.kind-research { color: var(--accent); border-color: var(--accent); }
.kind-world { color: var(--ok); border-color: var(--ok); }
.doc-title {
  background: none; border: none; color: inherit; text-align: left; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 0;
}
.doc-title:hover { color: var(--accent); }
.docs-footer { border-top: 1px solid var(--line); padding-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.gauge { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dim); }
.gauge-bar { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
.gauge-fill { height: 100%; background: var(--accent); }
.gauge.warn .gauge-fill { background: var(--warn); }
.settle {
  background: var(--accent); border: none; border-radius: 8px;
  padding: 8px; color: #10131a; font-weight: 600;
}
.settle:disabled { opacity: 0.4; }

/* ---- 오버레이 ---- */
.overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; z-index: 10;
}
.overlay-box {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  width: min(720px, 92vw); height: min(80vh, 700px);
  display: flex; flex-direction: column; padding: 16px; gap: 12px;
}
.overlay-head { display: flex; gap: 8px; align-items: center; }
.overlay-head input, .overlay-head select {
  background: var(--bg); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 8px; font: inherit;
}
.overlay-head input { flex: 1; }
.overlay-head button, .overlay-foot button {
  background: var(--line); color: var(--text); border: none;
  border-radius: 6px; padding: 6px 14px;
}
.overlay-body {
  flex: 1; overflow-y: auto; background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 12px;
}
textarea.overlay-body { resize: none; color: var(--text); font: inherit; width: 100%; }
.overlay-foot { display: flex; justify-content: flex-end; gap: 8px; }
.overlay-foot .primary { background: var(--accent); color: #10131a; font-weight: 600; }
.overlay-foot .primary:disabled { opacity: 0.4; }
.overlay-foot .danger { background: none; border: 1px solid var(--danger); color: var(--danger); margin-right: auto; }
.settle-pick { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
.settle-pick label { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 6px; }
.settle-pick label:hover { background: var(--line); }
.settle-error { color: var(--danger); }

/* ---- 마크다운 ---- */
.markdown { line-height: 1.6; }
.markdown h1, .markdown h2, .markdown h3 { margin: 0.6em 0 0.3em; line-height: 1.3; }
.markdown h1 { font-size: 1.3em; } .markdown h2 { font-size: 1.15em; } .markdown h3 { font-size: 1.05em; }
.markdown p, .markdown ul, .markdown ol, .markdown pre, .markdown table { margin: 0.4em 0; }
.markdown ul, .markdown ol { padding-left: 1.4em; }
.markdown code { background: var(--bg); padding: 1px 4px; border-radius: 4px; font-size: 0.92em; }
.markdown pre { background: var(--bg); padding: 10px; border-radius: 8px; overflow-x: auto; }
.markdown pre code { background: none; padding: 0; }
.markdown blockquote { border-left: 3px solid var(--line); padding-left: 10px; color: var(--dim); }
.markdown table { border-collapse: collapse; }
.markdown th, .markdown td { border: 1px solid var(--line); padding: 4px 8px; }
.markdown a { color: var(--accent); }
```

- [ ] **Step 4: 테스트 인프라**

`web/src/test/msw.ts`:

```ts
import { HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const server = setupServer()

const SSE_HEADERS = { 'Content-Type': 'text/event-stream' }

/** 이벤트 배열을 SSE 본문 한 덩어리로 응답 (컴포넌트 테스트용) */
export function sseResponse(events: Array<Record<string, unknown> | '[DONE]'>): HttpResponse {
  const body = events
    .map((e) => `data: ${e === '[DONE]' ? '[DONE]' : JSON.stringify(e)}\n\n`)
    .join('')
  return new HttpResponse(body, { headers: SSE_HEADERS })
}

/** 원시 문자열 청크들을 그대로 스트림으로 흘림 (파서 경계 테스트용) */
export function sseChunkedResponse(chunks: string[]): HttpResponse {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const ch of chunks) controller.enqueue(enc.encode(ch))
      controller.close()
    },
  })
  return new HttpResponse(stream, { headers: SSE_HEADERS })
}
```

`web/src/test/setup.ts`:

```ts
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
```

`web/src/test/utils.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  }
}
```

- [ ] **Step 5: 스모크 테스트 작성**

`web/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import App from './App'

test('앱 셸이 렌더된다', () => {
  render(<App />)
  expect(screen.getByText('atlas 로딩됨')).toBeInTheDocument()
})
```

- [ ] **Step 6: 게이트 실행**

```bash
cd web && npm run typecheck && npm test
```

Expected: typecheck 통과, 1 passed. (템플릿 App.css 제거로 App.tsx import가 깨져 있으면 Step 3 교체본이 이미 해결한 상태여야 한다.)

- [ ] **Step 7: Commit**

```bash
cd /Users/arden/code/atlas
git add -A web
git commit -m "feat(web): scaffold vite react-ts + test infra (vitest/RTL/MSW)"
```

---

### Task 2: API 타입 + 클라이언트 + Query 훅

**Files:**
- Create: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/api/hooks.ts`, `web/src/test/fixtures.ts`
- Test: `web/src/api/client.test.ts`, `web/src/api/hooks.test.tsx`

**Interfaces:**
- Consumes: Task 1의 테스트 인프라(`server`, `renderWithClient`).
- Produces (이후 전 태스크가 의존):
  - types.ts: `DocKind`, `Project`, `DocMeta`, `Doc`, `Thread`, `ThreadMeta`, `Message`, `ProjectDetail`, `ThreadDetail`, `BudgetDoc`, `Budget`, `Health`
  - client.ts: `class ApiError extends Error { status: number; detail: string }`, `api<T>(path, init?): Promise<T>`, `parseError(res): Promise<ApiError>`
  - hooks.ts: `budgetQueryString(docIds: number[] | null): string`, 조회 훅 `useHealth() / useProjects() / useProject(id: number|null) / useThread(id: number|null) / useBudget(threadId: number|null, docIds: number[]|null) / useDoc(id: number|null)`, 변이 훅 `useCreateProject() / useUpdateProject() / useDeleteProject() / useCreateThread() / useUpdateThread() / useDeleteThread() / useCreateDoc() / useUpdateDoc() / useDeleteDoc()` (파라미터 형태는 아래 코드가 정본)
  - fixtures.ts: `makeProject / makeDocMeta / makeDoc / makeThreadMeta / makeThread / makeMessage / makeBudget` (모두 `Partial` 오버라이드 인자)

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/api/client.test.ts`:

```ts
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw'
import { ApiError, api } from './client'

test('JSON 응답을 그대로 반환한다', async () => {
  server.use(http.get('/api/health', () => HttpResponse.json({ ok: true, gemma: false })))
  await expect(api('/api/health')).resolves.toEqual({ ok: true, gemma: false })
})

test('204는 undefined를 반환한다', async () => {
  server.use(http.delete('/api/docs/1', () => new HttpResponse(null, { status: 204 })))
  await expect(api('/api/docs/1', { method: 'DELETE' })).resolves.toBeUndefined()
})

test('에러 응답은 detail을 담은 ApiError로 던진다', async () => {
  server.use(
    http.get('/api/projects/9', () =>
      HttpResponse.json({ detail: 'project not found' }, { status: 404 }),
    ),
  )
  const err: unknown = await api('/api/projects/9').catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).status).toBe(404)
  expect((err as ApiError).detail).toBe('project not found')
})

test('JSON 아닌 에러 본문은 statusText로 대체한다', async () => {
  server.use(
    http.get('/api/broken', () =>
      new HttpResponse('boom', { status: 500, statusText: 'Internal Server Error' }),
    ),
  )
  const err = (await api('/api/broken').catch((e: unknown) => e)) as ApiError
  expect(err.detail).toBe('Internal Server Error')
})
```

`web/src/api/hooks.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../test/msw'
import { makeBudget, makeProject, makeThreadMeta } from '../test/fixtures'
import { budgetQueryString, useBudget, useCreateThread, useProject } from './hooks'

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

test('budgetQueryString: null=생략, []=빈 문자열 파라미터, 목록=콤마', () => {
  expect(budgetQueryString(null)).toBe('')
  expect(budgetQueryString([])).toBe('?doc_ids=')
  expect(budgetQueryString([1, 2])).toBe('?doc_ids=1,2')
})

test('useBudget이 선택 상태를 doc_ids 쿼리로 변환해 요청한다', async () => {
  let search: string | null = null
  server.use(
    http.get('/api/threads/7/budget', ({ request }) => {
      search = new URL(request.url).search
      return HttpResponse.json(makeBudget())
    }),
  )
  const { result } = renderHook(() => useBudget(7, [1, 2]), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(search).toBe('?doc_ids=1,2')
})

test('useCreateThread 성공 시 프로젝트 상세를 무효화한다', async () => {
  let projectGets = 0
  server.use(
    http.get('/api/projects/1', () => {
      projectGets += 1
      return HttpResponse.json({ project: makeProject(), docs: [], threads: [] })
    }),
    http.post('/api/projects/1/threads', () =>
      HttpResponse.json({ ...makeThreadMeta({ id: 5, title: '새 스레드' }), project_id: 1 }, { status: 201 }),
    ),
  )
  const wrapper = makeWrapper()
  const project = renderHook(() => useProject(1), { wrapper })
  await waitFor(() => expect(project.result.current.isSuccess).toBe(true))
  const create = renderHook(() => useCreateThread(), { wrapper })
  await create.result.current.mutateAsync({ projectId: 1, title: '새 스레드' })
  await waitFor(() => expect(projectGets).toBe(2))
})
```

주의: 같은 `wrapper` 클로저(=같은 QueryClient)를 두 `renderHook`에 써야 무효화가 관측된다.

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — `./client`, `./hooks`, `../test/fixtures` 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/api/types.ts`:

```ts
// server/main.py 응답 형태 그대로 — 필드 추가/이름 변경 금지 (API 계약 동결)
export type DocKind = 'idea' | 'research' | 'world' | 'note'

export interface Project {
  id: number
  slug: string
  name: string
  brief: string
  created_at: string
}

/** GET /api/projects/{id} 의 docs 항목 — content 없음 */
export interface DocMeta {
  id: number
  kind: DocKind
  title: string
  created_at: string
  updated_at: string
}

export interface Doc extends DocMeta {
  project_id: number
  content: string
}

/** GET /api/projects/{id} 의 threads 항목 — archived는 0/1 정수 */
export interface ThreadMeta {
  id: number
  title: string
  archived: number
  created_at: string
}

export interface Thread extends ThreadMeta {
  project_id: number
}

export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ProjectDetail {
  project: Project
  docs: DocMeta[]
  threads: ThreadMeta[]
}

export interface ThreadDetail {
  thread: Thread
  messages: Message[]
}

export interface BudgetDoc {
  id: number
  title: string
  tokens: number
}

/** total = system_tokens + history_tokens (문서 토큰은 system에 포함된 내역) */
export interface Budget {
  limit: number | null
  reserve: number
  total: number
  system_tokens: number
  history_tokens: number
  docs: BudgetDoc[]
  exact: boolean
}

export interface Health {
  ok: boolean
  gemma: boolean
}
```

`web/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}

/** FastAPI 에러 본문 {"detail": "..."} → ApiError. JSON이 아니면 statusText 사용. */
export async function parseError(res: Response): Promise<ApiError> {
  let detail = res.statusText
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') detail = body.detail
  } catch {
    // 본문이 JSON이 아님 — statusText 유지
  }
  return new ApiError(res.status, detail)
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
```

`web/src/test/fixtures.ts`:

```ts
import type { Budget, Doc, DocMeta, Message, Project, Thread, ThreadMeta } from '../api/types'

const TS = '2026-07-24 00:00:00'

export function makeProject(over: Partial<Project> = {}): Project {
  return { id: 1, slug: 'p', name: 'P', brief: '', created_at: TS, ...over }
}

export function makeDocMeta(over: Partial<DocMeta> = {}): DocMeta {
  return { id: 1, kind: 'note', title: '메모', created_at: TS, updated_at: TS, ...over }
}

export function makeDoc(over: Partial<Doc> = {}): Doc {
  return { ...makeDocMeta(), project_id: 1, content: '', ...over }
}

export function makeThreadMeta(over: Partial<ThreadMeta> = {}): ThreadMeta {
  return { id: 1, title: '스레드', archived: 0, created_at: TS, ...over }
}

export function makeThread(over: Partial<Thread> = {}): Thread {
  return { ...makeThreadMeta(), project_id: 1, ...over }
}

export function makeMessage(over: Partial<Message> = {}): Message {
  return { id: 1, role: 'user', content: '안녕', created_at: TS, ...over }
}

export function makeBudget(over: Partial<Budget> = {}): Budget {
  return {
    limit: 8192,
    reserve: 1024,
    total: 1000,
    system_tokens: 800,
    history_tokens: 200,
    docs: [],
    exact: true,
    ...over,
  }
}
```

`web/src/api/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  Budget, Doc, DocKind, Health, Project, ProjectDetail, Thread, ThreadDetail,
} from './types'

/** null=파라미터 생략(전체 문서), []=?doc_ids=(문서 없이) — ChatIn.doc_ids 시맨틱과 일치 */
export function budgetQueryString(docIds: number[] | null): string {
  return docIds === null ? '' : `?doc_ids=${docIds.join(',')}`
}

// ---- 조회 ----

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/api/health'),
    refetchInterval: 15_000,
  })
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/api/projects') })
}

export function useProject(id: number | null) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => api<ProjectDetail>(`/api/projects/${id}`),
    enabled: id !== null,
  })
}

export function useThread(id: number | null) {
  return useQuery({
    queryKey: ['thread', id],
    queryFn: () => api<ThreadDetail>(`/api/threads/${id}`),
    enabled: id !== null,
  })
}

export function useBudget(threadId: number | null, docIds: number[] | null) {
  return useQuery({
    queryKey: ['budget', threadId, docIds === null ? 'all' : docIds.join(',')],
    queryFn: () => api<Budget>(`/api/threads/${threadId}/budget${budgetQueryString(docIds)}`),
    enabled: threadId !== null,
  })
}

export function useDoc(id: number | null) {
  return useQuery({
    queryKey: ['doc', id],
    queryFn: () => api<Doc>(`/api/docs/${id}`),
    enabled: id !== null,
  })
}

// ---- 변이 (성공 시 관련 조회 무효화) ----

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; brief?: string }) =>
      api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; brief?: string } }) =>
      api<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['project', id] })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useCreateThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, title }: { projectId: number; title: string }) =>
      api<Thread>(`/api/projects/${projectId}/threads`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      }),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })
}

export function useUpdateThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: {
      id: number
      projectId: number
      patch: { title?: string; archived?: boolean }
    }) => api<Thread>(`/api/threads/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (_data, { id, projectId }) => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['thread', id] })
    },
  })
}

export function useDeleteThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; projectId: number }) =>
      api<void>(`/api/threads/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['project', projectId] }),
  })
}

export function useCreateDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, doc }: {
      projectId: number
      doc: { kind: DocKind; title: string; content: string }
    }) =>
      api<Doc>(`/api/projects/${projectId}/docs`, { method: 'POST', body: JSON.stringify(doc) }),
    onSuccess: (_data, { projectId }) => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useUpdateDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: {
      id: number
      projectId: number
      patch: Partial<{ kind: DocKind; title: string; content: string }>
    }) => api<Doc>(`/api/docs/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: (_data, { id, projectId }) => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['doc', id] })
      void qc.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}

export function useDeleteDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; projectId: number }) =>
      api<void>(`/api/docs/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, { projectId }) => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['budget'] })
    },
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (스모크 1 + 신규 7 = 8 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/api web/src/test/fixtures.ts
git commit -m "feat(web): typed api client + tanstack query hooks"
```

---

### Task 3: SSE 파서 유틸

**Files:**
- Create: `web/src/api/sse.ts`
- Test: `web/src/api/sse.test.ts`

**Interfaces:**
- Consumes: `parseError`, `ApiError` (Task 2 client.ts), `sseChunkedResponse`(Task 1).
- Produces: `interface SSEHandlers { onDelta: (text: string) => void; onError: (message: string) => void }`, `streamSSE(url: string, body: unknown, handlers: SSEHandlers, signal?: AbortSignal): Promise<void>` — HTTP 에러는 시작 전 `ApiError`로 throw, abort는 조용히 resolve. ChatPane(Task 5)·SettleOverlay(Task 8)가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/api/sse.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test -- sse`
Expected: FAIL — `./sse` 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/api/sse.ts`:

```ts
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
    reader.releaseLock()
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (14 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/api/sse.ts web/src/api/sse.test.ts
git commit -m "feat(web): shared sse stream parser"
```

---

### Task 4: Sidebar (프로젝트/스레드 목록 + gemma 상태)

**Files:**
- Create: `web/src/components/Sidebar.tsx`
- Test: `web/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 2 훅 전부, fixtures.
- Produces:

```ts
interface SidebarProps {
  selectedProjectId: number | null
  selectedThreadId: number | null
  onSelectProject: (id: number | null) => void
  onSelectThread: (id: number | null) => void
}
export function Sidebar(props: SidebarProps): JSX.Element
```

이름 입력은 `window.prompt`, 삭제 확인은 `window.confirm` (로컬 단일 사용자 도구 — 인라인 폼 YAGNI). 접근성 라벨(테스트가 의존): 버튼 `새 프로젝트`/`새 스레드`/`프로젝트 이름 변경`/`프로젝트 삭제`/`스레드 이름 변경`/`스레드 보관`/`보관 해제`/`스레드 삭제`, 상태 점 `title="Gemma 상태"`.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/components/Sidebar.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw'
import { renderWithClient } from '../test/utils'
import { makeProject, makeThreadMeta } from '../test/fixtures'
import { Sidebar } from './Sidebar'

const noop = () => {}

function healthHandler(gemma: boolean) {
  return http.get('/api/health', () => HttpResponse.json({ ok: true, gemma }))
}

test('프로젝트 목록과 gemma 상태(up)를 표시한다', async () => {
  server.use(
    healthHandler(true),
    http.get('/api/projects', () =>
      HttpResponse.json([makeProject({ id: 1, name: '아틀라스' }), makeProject({ id: 2, name: '차크', slug: 'c' })]),
    ),
  )
  renderWithClient(
    <Sidebar selectedProjectId={null} selectedThreadId={null} onSelectProject={noop} onSelectThread={noop} />,
  )
  expect(await screen.findByText('아틀라스')).toBeInTheDocument()
  expect(screen.getByText('차크')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTitle('Gemma 상태')).toHaveClass('up'))
})

test('프로젝트 클릭 → onSelectProject', async () => {
  const onSelect = vi.fn()
  server.use(
    healthHandler(false),
    http.get('/api/projects', () => HttpResponse.json([makeProject({ id: 3, name: '고르기' })])),
  )
  renderWithClient(
    <Sidebar selectedProjectId={null} selectedThreadId={null} onSelectProject={onSelect} onSelectThread={noop} />,
  )
  await userEvent.click(await screen.findByText('고르기'))
  expect(onSelect).toHaveBeenCalledWith(3)
})

test('새 프로젝트: prompt 입력으로 POST하고 목록을 갱신한다', async () => {
  let posted: unknown = null
  let listCalls = 0
  vi.spyOn(window, 'prompt').mockReturnValue('  새 프로젝트  ')
  server.use(
    healthHandler(false),
    http.get('/api/projects', () => {
      listCalls += 1
      return HttpResponse.json(listCalls === 1 ? [] : [makeProject({ id: 9, name: '새 프로젝트' })])
    }),
    http.post('/api/projects', async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json(makeProject({ id: 9, name: '새 프로젝트' }), { status: 201 })
    }),
  )
  renderWithClient(
    <Sidebar selectedProjectId={null} selectedThreadId={null} onSelectProject={noop} onSelectThread={noop} />,
  )
  await userEvent.click(screen.getByLabelText('새 프로젝트'))
  expect(await screen.findByText('새 프로젝트')).toBeInTheDocument()
  expect(posted).toEqual({ name: '새 프로젝트' }) // 공백 trim
})

test('선택된 프로젝트의 스레드 목록: 클릭 선택·생성·보관 토글', async () => {
  const onSelectThread = vi.fn()
  let patched: unknown = null
  let threadPosted: unknown = null
  vi.spyOn(window, 'prompt').mockReturnValue('신규 스레드')
  server.use(
    healthHandler(false),
    http.get('/api/projects', () => HttpResponse.json([makeProject({ id: 1 })])),
    http.get('/api/projects/1', () =>
      HttpResponse.json({
        project: makeProject({ id: 1 }),
        docs: [],
        threads: [makeThreadMeta({ id: 11, title: '세계관 대화' }), makeThreadMeta({ id: 12, title: '옛날 것', archived: 1 })],
      }),
    ),
    http.post('/api/projects/1/threads', async ({ request }) => {
      threadPosted = await request.json()
      return HttpResponse.json({ ...makeThreadMeta({ id: 13, title: '신규 스레드' }), project_id: 1 }, { status: 201 })
    }),
    http.patch('/api/threads/11', async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ ...makeThreadMeta({ id: 11, archived: 1 }), project_id: 1 })
    }),
  )
  renderWithClient(
    <Sidebar selectedProjectId={1} selectedThreadId={null} onSelectProject={noop} onSelectThread={onSelectThread} />,
  )
  await userEvent.click(await screen.findByText('세계관 대화'))
  expect(onSelectThread).toHaveBeenCalledWith(11)

  await userEvent.click(screen.getByLabelText('새 스레드'))
  await waitFor(() => expect(threadPosted).toEqual({ title: '신규 스레드' }))
  expect(onSelectThread).toHaveBeenCalledWith(13) // 생성 직후 자동 선택

  await userEvent.click(screen.getAllByLabelText('스레드 보관')[0]!)
  await waitFor(() => expect(patched).toEqual({ archived: true }))
  expect(screen.getByLabelText('보관 해제')).toBeInTheDocument() // 옛날 것(archived)
})

test('프로젝트 삭제: confirm 거부 시 DELETE를 보내지 않는다', async () => {
  let deleted = false
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  server.use(
    healthHandler(false),
    http.get('/api/projects', () => HttpResponse.json([makeProject({ id: 1, name: '지울까' })])),
    http.get('/api/projects/1', () =>
      HttpResponse.json({ project: makeProject({ id: 1 }), docs: [], threads: [] }),
    ),
    http.delete('/api/projects/1', () => {
      deleted = true
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderWithClient(
    <Sidebar selectedProjectId={1} selectedThreadId={null} onSelectProject={noop} onSelectThread={noop} />,
  )
  await userEvent.click(await screen.findByLabelText('프로젝트 삭제'))
  expect(deleted).toBe(false)
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test -- Sidebar`
Expected: FAIL — `./Sidebar` 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/components/Sidebar.tsx`:

```tsx
import {
  useCreateProject, useCreateThread, useDeleteProject, useDeleteThread,
  useHealth, useProject, useProjects, useUpdateProject, useUpdateThread,
} from '../api/hooks'
import type { Project, ThreadMeta } from '../api/types'

interface SidebarProps {
  selectedProjectId: number | null
  selectedThreadId: number | null
  onSelectProject: (id: number | null) => void
  onSelectThread: (id: number | null) => void
}

export function Sidebar({
  selectedProjectId, selectedThreadId, onSelectProject, onSelectThread,
}: SidebarProps) {
  const projects = useProjects()
  const detail = useProject(selectedProjectId)
  const health = useHealth()
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const createThread = useCreateThread()
  const updateThread = useUpdateThread()
  const deleteThread = useDeleteThread()

  function addProject() {
    const name = window.prompt('프로젝트 이름')?.trim()
    if (name) createProject.mutate({ name })
  }

  function renameProject(p: Project) {
    const name = window.prompt('프로젝트 이름', p.name)?.trim()
    if (name && name !== p.name) updateProject.mutate({ id: p.id, patch: { name } })
  }

  function removeProject(p: Project) {
    if (!window.confirm(`"${p.name}" 프로젝트를 삭제할까요? 문서·스레드도 함께 지워집니다.`)) return
    deleteProject.mutate(p.id, {
      onSuccess: () => {
        if (selectedProjectId === p.id) onSelectProject(null)
      },
    })
  }

  function addThread() {
    if (selectedProjectId === null) return
    const title = window.prompt('스레드 제목')?.trim()
    if (!title) return
    createThread.mutate(
      { projectId: selectedProjectId, title },
      { onSuccess: (t) => onSelectThread(t.id) },
    )
  }

  function renameThread(t: ThreadMeta) {
    if (selectedProjectId === null) return
    const title = window.prompt('스레드 제목', t.title)?.trim()
    if (title && title !== t.title) {
      updateThread.mutate({ id: t.id, projectId: selectedProjectId, patch: { title } })
    }
  }

  function removeThread(t: ThreadMeta) {
    if (selectedProjectId === null) return
    if (!window.confirm(`"${t.title}" 스레드를 삭제할까요? 메시지도 함께 지워집니다.`)) return
    deleteThread.mutate(
      { id: t.id, projectId: selectedProjectId },
      {
        onSuccess: () => {
          if (selectedThreadId === t.id) onSelectThread(null)
        },
      },
    )
  }

  const gemma = health.data?.gemma
  const threads = detail.data?.threads ?? []

  return (
    <aside className="sidebar">
      <header>
        <h1>atlas</h1>
        <span
          className={`status ${gemma === undefined ? '' : gemma ? 'up' : 'down'}`}
          title="Gemma 상태"
        >
          ●
        </span>
      </header>
      <section>
        <div className="section-head">
          <h2>프로젝트</h2>
          <button aria-label="새 프로젝트" onClick={addProject}>+</button>
        </div>
        <ul>
          {(projects.data ?? []).map((p) => (
            <li key={p.id} className={p.id === selectedProjectId ? 'active' : ''}>
              <button className="row-main" onClick={() => onSelectProject(p.id)}>{p.name}</button>
              <span className="row-actions">
                <button aria-label="프로젝트 이름 변경" onClick={() => renameProject(p)}>✎</button>
                <button aria-label="프로젝트 삭제" onClick={() => removeProject(p)}>✕</button>
              </span>
            </li>
          ))}
          {projects.data?.length === 0 && <li className="dim">프로젝트 없음</li>}
        </ul>
      </section>
      {selectedProjectId !== null && (
        <section>
          <div className="section-head">
            <h2>스레드</h2>
            <button aria-label="새 스레드" onClick={addThread}>+</button>
          </div>
          <ul>
            {threads.map((t) => (
              <li
                key={t.id}
                className={[t.id === selectedThreadId ? 'active' : '', t.archived ? 'archived' : '']
                  .join(' ')
                  .trim()}
              >
                <button className="row-main" onClick={() => onSelectThread(t.id)}>{t.title}</button>
                <span className="row-actions">
                  <button aria-label="스레드 이름 변경" onClick={() => renameThread(t)}>✎</button>
                  <button
                    aria-label={t.archived ? '보관 해제' : '스레드 보관'}
                    onClick={() =>
                      updateThread.mutate({
                        id: t.id,
                        projectId: selectedProjectId,
                        patch: { archived: !t.archived },
                      })
                    }
                  >
                    ▤
                  </button>
                  <button aria-label="스레드 삭제" onClick={() => removeThread(t)}>✕</button>
                </span>
              </li>
            ))}
            {threads.length === 0 && <li className="dim">스레드 없음</li>}
          </ul>
        </section>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (19 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Sidebar.tsx web/src/components/Sidebar.test.tsx
git commit -m "feat(web): sidebar - project/thread lists, crud, gemma status"
```

---

### Task 5: Markdown + ChatPane (SSE 챗)

**Files:**
- Create: `web/src/components/Markdown.tsx`, `web/src/components/ChatPane.tsx`
- Test: `web/src/components/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `useThread`(Task 2), `streamSSE`/`ApiError`(Task 3·2), `sseResponse`(Task 1).
- Produces:

```ts
export function Markdown({ text }: { text: string }): JSX.Element
interface ChatPaneProps {
  threadId: number
  docIds: number[] | null // null = 전체 문서(요청에서 doc_ids 생략) — DocsPanel 체크 상태와 동일 시맨틱
}
export function ChatPane(props: ChatPaneProps): JSX.Element
```

동작 계약: 전송 시 사용자 메시지를 낙관적으로 표시하고 delta를 누적 렌더. 스트림 종료(정상/중단/에러) 후 `['thread', threadId]`·`['budget', threadId]` 무효화. HTTP 에러(413 등)는 서버 `detail`을 인라인 표시하고 **입력을 복원**한다(서버가 user 메시지를 저장하지 않았으므로). 스트리밍 중 textarea 비활성 + [중단] 버튼. Enter 전송, Shift+Enter 줄바꿈.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/components/ChatPane.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server, sseResponse } from '../test/msw'
import { renderWithClient } from '../test/utils'
import { makeMessage, makeThread } from '../test/fixtures'
import { ChatPane } from './ChatPane'

function threadHandler(messagesPerCall: Array<ReturnType<typeof makeMessage>[]>) {
  let call = 0
  return http.get('/api/threads/1', () => {
    const messages = messagesPerCall[Math.min(call, messagesPerCall.length - 1)]
    call += 1
    return HttpResponse.json({ thread: makeThread({ id: 1 }), messages })
  })
}

test('메시지를 렌더하고 assistant는 마크다운으로 그린다', async () => {
  server.use(
    threadHandler([
      [makeMessage({ id: 1, role: 'user', content: '안녕' }),
       makeMessage({ id: 2, role: 'assistant', content: '**굵게** 답함' })],
    ]),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  expect(await screen.findByText('안녕')).toBeInTheDocument()
  const bold = await screen.findByText('굵게')
  expect(bold.tagName).toBe('STRONG')
})

test('전송 → delta 누적 → 완료 후 재조회본 표시, docIds=null이면 doc_ids 생략', async () => {
  let chatBody: unknown = null
  server.use(
    threadHandler([
      [],
      [makeMessage({ id: 1, role: 'user', content: '용 얘기 하자' }),
       makeMessage({ id: 2, role: 'assistant', content: '좋아, 용부터 정하자' })],
    ]),
    http.post('/api/threads/1/chat', async ({ request }) => {
      chatBody = await request.json()
      return sseResponse([{ delta: '좋아, ' }, { delta: '용부터 정하자' }, '[DONE]'])
    }),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '용 얘기 하자')
  await userEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(await screen.findByText('좋아, 용부터 정하자')).toBeInTheDocument()
  expect(chatBody).toEqual({ message: '용 얘기 하자' }) // doc_ids 없음
  expect(screen.getByLabelText('메시지 입력')).toHaveValue('')
})

test('docIds가 목록이면 doc_ids로 보낸다', async () => {
  let chatBody: unknown = null
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', async ({ request }) => {
      chatBody = await request.json()
      return sseResponse(['[DONE]'])
    }),
  )
  renderWithClient(<ChatPane threadId={1} docIds={[2, 5]} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '가자')
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(chatBody).toEqual({ message: '가자', doc_ids: [2, 5] }))
})

test('SSE error 이벤트는 인라인 에러로 표시한다', async () => {
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', () =>
      sseResponse([{ delta: '부분 답' }, { error: 'llama-server(:8080)에 연결할 수 없어요.' }, '[DONE]']),
    ),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '있니')
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByText(/연결할 수 없어요/)).toBeInTheDocument()
})

test('413이면 detail을 보여주고 입력을 복원한다', async () => {
  const detail = '컨텍스트 초과 예상 (9000/8192 토큰). 문서 선택을 줄이거나 새 스레드에서 계속하세요.'
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', () => HttpResponse.json({ detail }, { status: 413 })),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '긴 얘기')
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByText(detail)).toBeInTheDocument()
  expect(screen.getByLabelText('메시지 입력')).toHaveValue('긴 얘기')
})

test('스트리밍 중 [중단]을 누르면 초기 상태로 돌아온다', async () => {
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', () => {
      const enc = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode('data: {"delta": "끝나지 않는"}\n\n'))
        },
      })
      return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '멈춰볼게')
  await userEvent.keyboard('{Enter}')
  await userEvent.click(await screen.findByRole('button', { name: '중단' }))
  expect(await screen.findByRole('button', { name: '전송' })).toBeInTheDocument()
  expect(screen.getByLabelText('메시지 입력')).not.toBeDisabled()
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test -- ChatPane`
Expected: FAIL — `./ChatPane` 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/components/Markdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
```

`web/src/components/ChatPane.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { useThread } from '../api/hooks'
import { streamSSE } from '../api/sse'
import { Markdown } from './Markdown'

interface ChatPaneProps {
  threadId: number
  docIds: number[] | null
}

export function ChatPane({ threadId, docIds }: ChatPaneProps) {
  const qc = useQueryClient()
  const { data } = useThread(threadId)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<{ user: string; draft: string } | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const messages = data?.messages ?? []

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages.length, streaming?.draft])

  async function send() {
    const message = input.trim()
    if (!message || streaming) return
    setInput('')
    setChatError(null)
    setStreaming({ user: message, draft: '' })
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await streamSSE(
        `/api/threads/${threadId}/chat`,
        docIds === null ? { message } : { message, doc_ids: docIds },
        {
          onDelta: (t) => setStreaming((s) => (s ? { ...s, draft: s.draft + t } : s)),
          onError: (m) => setChatError(m),
        },
        ac.signal,
      )
    } catch (e) {
      // HTTP 에러(413 등)는 스트림 시작 전 — 서버가 user 메시지를 저장하지 않았으므로 입력 복원
      setChatError(e instanceof ApiError ? e.detail : '요청에 실패했어요. 서버가 떠 있는지 확인하세요.')
      setInput(message)
    } finally {
      abortRef.current = null
      await qc.invalidateQueries({ queryKey: ['thread', threadId] })
      await qc.invalidateQueries({ queryKey: ['budget', threadId] })
      setStreaming(null)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <>
      <header className="chat-head">
        <h2>{data?.thread.title ?? ''}</h2>
      </header>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !streaming && !chatError && (
          <p className="placeholder">첫 메시지를 보내보세요.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
          </div>
        ))}
        {streaming && (
          <>
            <div className="msg user">{streaming.user}</div>
            <div className="msg assistant streaming">
              <Markdown text={streaming.draft} />
            </div>
          </>
        )}
        {chatError && <div className="msg error">{chatError}</div>}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          aria-label="메시지 입력"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="세계관 얘기해보자… (Enter 전송, Shift+Enter 줄바꿈)"
          disabled={streaming !== null}
        />
        {streaming ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>중단</button>
        ) : (
          <button type="submit" disabled={!input.trim()}>전송</button>
        )}
      </form>
    </>
  )
}
```

구현 노트: 정상 종료 시 재조회를 먼저 기다린 뒤 스트리밍 버블을 지운다(저장본과 잠깐 겹칠 수 있음 — 공백 깜빡임보다 낫다). 중단 시 서버는 finally에서 받은 만큼 저장하므로 재조회가 부분 답을 보여준다.

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (25 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Markdown.tsx web/src/components/ChatPane.tsx web/src/components/ChatPane.test.tsx
git commit -m "feat(web): chat pane - sse streaming, markdown, abort, error surfaces"
```

---

### Task 6: BudgetGauge + DocsPanel (문서 체크박스 + 예산)

**Files:**
- Create: `web/src/components/BudgetGauge.tsx`, `web/src/components/DocsPanel.tsx`
- Test: `web/src/components/BudgetGauge.test.tsx`, `web/src/components/DocsPanel.test.tsx`

**Interfaces:**
- Consumes: `useProject`/`useBudget`(Task 2), `Budget`/`DocMeta` 타입.
- Produces:

```ts
interface BudgetGaugeProps { budget: Budget | undefined; isLoading: boolean }
export function BudgetGauge(props: BudgetGaugeProps): JSX.Element

interface DocsPanelProps {
  projectId: number
  threadId: number | null            // null이면 게이지 자리표시 + 정착 비활성
  docIds: number[] | null            // null = 전체 선택
  onChangeDocIds: (ids: number[] | null) => void
  onOpenDoc: (id: number | 'new') => void
  onSettle: () => void
}
export function DocsPanel(props: DocsPanelProps): JSX.Element
```

체크 규칙: 체크됨 = `docIds === null || docIds.includes(id)`. 토글 결과가 전체와 같으면 `null`로 정규화(→ 요청에서 doc_ids 생략), 아니면 배열 그대로. 게이지: `usable = limit - reserve`, `pct = min(100, round(100 * total / usable))`, 85% 이상 `warn` 클래스, `exact: false`면 "· 추정" 표기, `limit === null`이면 절대값만.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/components/BudgetGauge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { makeBudget } from '../test/fixtures'
import { BudgetGauge } from './BudgetGauge'

test('로딩 중 표시', () => {
  render(<BudgetGauge budget={undefined} isLoading={true} />)
  expect(screen.getByText('예산 계산 중…')).toBeInTheDocument()
})

test('정상: total/usable와 퍼센트', () => {
  render(<BudgetGauge budget={makeBudget({ total: 3584, limit: 8192, reserve: 1024 })} isLoading={false} />)
  expect(screen.getByText('3584 / 7168 tok (50%)')).toBeInTheDocument()
})

test('추정치면 표기가 붙는다', () => {
  render(<BudgetGauge budget={makeBudget({ total: 3584, exact: false })} isLoading={false} />)
  expect(screen.getByText(/· 추정/)).toBeInTheDocument()
})

test('85% 이상이면 warn 클래스', () => {
  const { container } = render(
    <BudgetGauge budget={makeBudget({ total: 6900, limit: 8192, reserve: 1024 })} isLoading={false} />,
  )
  expect(container.querySelector('.gauge')).toHaveClass('warn') // 6900/7168 = 96%
})

test('limit이 null이면 절대값 + 한도 미확인', () => {
  render(<BudgetGauge budget={makeBudget({ limit: null, total: 1234, exact: false })} isLoading={false} />)
  expect(screen.getByText(/~1234 tok \(한도 미확인/)).toBeInTheDocument()
})
```

`web/src/components/DocsPanel.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw'
import { renderWithClient } from '../test/utils'
import { makeBudget, makeDocMeta, makeProject } from '../test/fixtures'
import { DocsPanel } from './DocsPanel'

const noop = () => {}

function projectHandler(docs = [makeDocMeta({ id: 1, kind: 'idea', title: '기획' }), makeDocMeta({ id: 2, kind: 'research', title: '조사' })]) {
  return http.get('/api/projects/1', () =>
    HttpResponse.json({ project: makeProject({ id: 1 }), docs, threads: [] }),
  )
}

function budgetCapture() {
  const calls: string[] = []
  const handler = http.get('/api/threads/7/budget', ({ request }) => {
    calls.push(new URL(request.url).search)
    return HttpResponse.json(makeBudget())
  })
  return { calls, handler }
}

test('전체 선택(docIds=null)이면 budget 요청에 doc_ids가 없다', async () => {
  const { calls, handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={null} onChangeDocIds={noop} onOpenDoc={noop} onSettle={noop} />,
  )
  expect(await screen.findByText('기획')).toBeInTheDocument()
  await waitFor(() => expect(calls).toEqual(['']))
  expect(screen.getByLabelText('기획 선택')).toBeChecked()
  expect(screen.getByLabelText('조사 선택')).toBeChecked()
  expect(screen.getByText('idea')).toBeInTheDocument() // kind 뱃지
})

test('전체 해제(docIds=[])면 ?doc_ids= 로 요청한다', async () => {
  const { calls, handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={[]} onChangeDocIds={noop} onOpenDoc={noop} onSettle={noop} />,
  )
  await waitFor(() => expect(calls).toEqual(['?doc_ids=']))
  expect(await screen.findByLabelText('기획 선택')).not.toBeChecked()
})

test('전체 선택 상태에서 하나 해제 → 남은 id 배열', async () => {
  const onChange = vi.fn()
  const { handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={null} onChangeDocIds={onChange} onOpenDoc={noop} onSettle={noop} />,
  )
  await userEvent.click(await screen.findByLabelText('조사 선택'))
  expect(onChange).toHaveBeenCalledWith([1])
})

test('부분 선택에서 나머지 체크 → null로 정규화', async () => {
  const onChange = vi.fn()
  const { handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={[1]} onChangeDocIds={onChange} onOpenDoc={noop} onSettle={noop} />,
  )
  await userEvent.click(await screen.findByLabelText('조사 선택'))
  expect(onChange).toHaveBeenCalledWith(null)
})

test('문서 제목 클릭 → onOpenDoc(id), 새 문서 → onOpenDoc("new"), 정착 → onSettle', async () => {
  const onOpenDoc = vi.fn()
  const onSettle = vi.fn()
  const { handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={null} onChangeDocIds={noop} onOpenDoc={onOpenDoc} onSettle={onSettle} />,
  )
  await userEvent.click(await screen.findByText('기획'))
  expect(onOpenDoc).toHaveBeenCalledWith(1)
  await userEvent.click(screen.getByLabelText('새 문서'))
  expect(onOpenDoc).toHaveBeenCalledWith('new')
  await userEvent.click(screen.getByRole('button', { name: '정착' }))
  expect(onSettle).toHaveBeenCalled()
})

test('threadId가 null이면 게이지 자리표시 + 정착 비활성 (budget 요청 없음)', async () => {
  server.use(projectHandler())
  renderWithClient(
    <DocsPanel projectId={1} threadId={null} docIds={null} onChangeDocIds={noop} onOpenDoc={noop} onSettle={noop} />,
  )
  expect(await screen.findByText('스레드를 선택하면 예산이 표시됩니다')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '정착' })).toBeDisabled()
})
```

(마지막 테스트에서 budget 핸들러를 등록하지 않았으므로, 요청이 나가면 `onUnhandledRequest: 'error'`가 잡는다 — enabled 게이트 검증을 겸한다.)

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test -- -t 게이지 DocsPanel` 또는 `npm test`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/components/BudgetGauge.tsx`:

```tsx
import type { Budget } from '../api/types'

interface BudgetGaugeProps {
  budget: Budget | undefined
  isLoading: boolean
}

export function BudgetGauge({ budget, isLoading }: BudgetGaugeProps) {
  if (isLoading || !budget) {
    return (
      <div className="gauge">
        <span className="dim">예산 계산 중…</span>
      </div>
    )
  }
  const approx = budget.exact ? '' : ' · 추정'
  if (budget.limit === null) {
    return (
      <div className="gauge">
        <span className="dim">~{budget.total} tok (한도 미확인{approx})</span>
      </div>
    )
  }
  const usable = budget.limit - budget.reserve
  const pct = Math.min(100, Math.round((budget.total / usable) * 100))
  return (
    <div className={pct >= 85 ? 'gauge warn' : 'gauge'}>
      <div className="gauge-bar">
        <div className="gauge-fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{`${budget.total} / ${usable} tok (${pct}%)${approx}`}</span>
    </div>
  )
}
```

`web/src/components/DocsPanel.tsx`:

```tsx
import { useBudget, useProject } from '../api/hooks'
import { BudgetGauge } from './BudgetGauge'

interface DocsPanelProps {
  projectId: number
  threadId: number | null
  docIds: number[] | null
  onChangeDocIds: (ids: number[] | null) => void
  onOpenDoc: (id: number | 'new') => void
  onSettle: () => void
}

export function DocsPanel({
  projectId, threadId, docIds, onChangeDocIds, onOpenDoc, onSettle,
}: DocsPanelProps) {
  const { data } = useProject(projectId)
  const budget = useBudget(threadId, docIds)
  const docs = data?.docs ?? []

  function toggle(docId: number) {
    const all = docs.map((d) => d.id)
    const current = docIds === null ? all : docIds
    const next = current.includes(docId)
      ? current.filter((i) => i !== docId)
      : [...current, docId]
    const isAll = next.length === all.length && all.every((i) => next.includes(i))
    onChangeDocIds(isAll ? null : next)
  }

  return (
    <aside className="docs-panel">
      <div className="section-head">
        <h2>문서</h2>
        <button aria-label="새 문서" onClick={() => onOpenDoc('new')}>+</button>
      </div>
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d.id}>
            <input
              type="checkbox"
              aria-label={`${d.title} 선택`}
              checked={docIds === null || docIds.includes(d.id)}
              onChange={() => toggle(d.id)}
            />
            <span className={`kind kind-${d.kind}`}>{d.kind}</span>
            <button className="doc-title" onClick={() => onOpenDoc(d.id)}>{d.title}</button>
          </li>
        ))}
        {docs.length === 0 && <li className="dim">문서 없음</li>}
      </ul>
      <div className="docs-footer">
        {threadId !== null ? (
          <BudgetGauge budget={budget.data} isLoading={budget.isLoading} />
        ) : (
          <div className="gauge">
            <span className="dim">스레드를 선택하면 예산이 표시됩니다</span>
          </div>
        )}
        <button className="settle" onClick={onSettle} disabled={threadId === null}>정착</button>
      </div>
    </aside>
  )
}
```

체크박스를 바꾸면 `docIds`가 바뀌고 → `useBudget` 쿼리키가 바뀌어 자동 재조회된다(별도 배선 불필요). 챗 스트림 종료 후 갱신은 ChatPane의 `['budget', threadId]` 무효화가 담당.

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (36 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/BudgetGauge.tsx web/src/components/BudgetGauge.test.tsx web/src/components/DocsPanel.tsx web/src/components/DocsPanel.test.tsx
git commit -m "feat(web): docs panel - doc checkboxes with budget gauge"
```

---

### Task 7: DocEditor 오버레이 (문서 열람/편집)

**Files:**
- Create: `web/src/components/DocEditor.tsx`
- Test: `web/src/components/DocEditor.test.tsx`

**Interfaces:**
- Consumes: `useDoc`/`useCreateDoc`/`useUpdateDoc`/`useDeleteDoc`(Task 2), `Markdown`(Task 5).
- Produces:

```ts
interface DocEditorProps {
  projectId: number
  docId: number | 'new'
  onClose: () => void
}
export function DocEditor(props: DocEditorProps): JSX.Element | null
```

접근성(테스트 의존): 오버레이 `role="dialog" aria-label="문서 편집"`, 입력 `제목`(input)/`종류`(select)/`본문`(textarea), 버튼 `미리보기`↔`편집`/`저장`/`닫기`/`삭제`(기존 문서만). 저장: 신규 → `POST /api/projects/{id}/docs`, 기존 → `PUT /api/docs/{id}` (kind·title·content 전부 전송). 제목이 비면 저장 비활성.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/components/DocEditor.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw'
import { renderWithClient } from '../test/utils'
import { makeDoc } from '../test/fixtures'
import { DocEditor } from './DocEditor'

test('기존 문서를 불러와 수정·저장하면 PUT을 보낸다', async () => {
  const onClose = vi.fn()
  let putBody: unknown = null
  server.use(
    http.get('/api/docs/5', () =>
      HttpResponse.json(makeDoc({ id: 5, kind: 'world', title: '세계관', content: '# 대륙' })),
    ),
    http.put('/api/docs/5', async ({ request }) => {
      putBody = await request.json()
      return HttpResponse.json(makeDoc({ id: 5, kind: 'world', title: '세계관 v2', content: '# 대륙과 바다' }))
    }),
  )
  renderWithClient(<DocEditor projectId={1} docId={5} onClose={onClose} />)
  const title = await screen.findByLabelText('제목')
  expect(title).toHaveValue('세계관')
  expect(screen.getByLabelText('본문')).toHaveValue('# 대륙')

  await userEvent.clear(title)
  await userEvent.type(title, '세계관 v2')
  await userEvent.clear(screen.getByLabelText('본문'))
  await userEvent.type(screen.getByLabelText('본문'), '# 대륙과 바다')
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() =>
    expect(putBody).toEqual({ kind: 'world', title: '세계관 v2', content: '# 대륙과 바다' }),
  )
  expect(onClose).toHaveBeenCalled()
})

test('미리보기 토글은 마크다운을 렌더한다', async () => {
  server.use(
    http.get('/api/docs/5', () =>
      HttpResponse.json(makeDoc({ id: 5, title: '문서', content: '# 제목이다' })),
    ),
  )
  renderWithClient(<DocEditor projectId={1} docId={5} onClose={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: '미리보기' }))
  expect(screen.getByRole('heading', { name: '제목이다' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '편집' }))
  expect(screen.getByLabelText('본문')).toHaveValue('# 제목이다')
})

test('새 문서는 POST하고 닫는다 (kind 선택 반영)', async () => {
  const onClose = vi.fn()
  let postBody: unknown = null
  server.use(
    http.post('/api/projects/1/docs', async ({ request }) => {
      postBody = await request.json()
      return HttpResponse.json(makeDoc({ id: 9, kind: 'idea', title: '새 기획', content: '내용' }), { status: 201 })
    }),
  )
  renderWithClient(<DocEditor projectId={1} docId="new" onClose={onClose} />)
  expect(screen.getByRole('button', { name: '저장' })).toBeDisabled() // 제목 없음
  await userEvent.type(screen.getByLabelText('제목'), '새 기획')
  await userEvent.selectOptions(screen.getByLabelText('종류'), 'idea')
  await userEvent.type(screen.getByLabelText('본문'), '내용')
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(postBody).toEqual({ kind: 'idea', title: '새 기획', content: '내용' }))
  expect(onClose).toHaveBeenCalled()
})

test('삭제는 confirm 후 DELETE, 새 문서에는 삭제 버튼이 없다', async () => {
  const onClose = vi.fn()
  let deleted = false
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  server.use(
    http.get('/api/docs/5', () => HttpResponse.json(makeDoc({ id: 5, title: '지울 문서' }))),
    http.delete('/api/docs/5', () => {
      deleted = true
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderWithClient(<DocEditor projectId={1} docId={5} onClose={onClose} />)
  await userEvent.click(await screen.findByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deleted).toBe(true))
  expect(onClose).toHaveBeenCalled()

  onClose.mockClear()
  renderWithClient(<DocEditor projectId={1} docId="new" onClose={onClose} />)
  expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test -- DocEditor`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/components/DocEditor.tsx`:

```tsx
import { useState } from 'react'
import { useCreateDoc, useDeleteDoc, useDoc, useUpdateDoc } from '../api/hooks'
import type { Doc, DocKind } from '../api/types'
import { Markdown } from './Markdown'

const KINDS: DocKind[] = ['idea', 'research', 'world', 'note']

interface DocEditorProps {
  projectId: number
  docId: number | 'new'
  onClose: () => void
}

export function DocEditor({ projectId, docId, onClose }: DocEditorProps) {
  const isNew = docId === 'new'
  const { data } = useDoc(isNew ? null : docId)
  if (!isNew && !data) return null // 로딩 완료 후 폼을 초기화하기 위해 그 전엔 그리지 않는다
  return <DocEditorForm projectId={projectId} doc={isNew ? null : data!} onClose={onClose} />
}

function DocEditorForm({
  projectId, doc, onClose,
}: {
  projectId: number
  doc: Doc | null
  onClose: () => void
}) {
  const [kind, setKind] = useState<DocKind>(doc?.kind ?? 'note')
  const [title, setTitle] = useState(doc?.title ?? '')
  const [content, setContent] = useState(doc?.content ?? '')
  const [preview, setPreview] = useState(false)
  const createDoc = useCreateDoc()
  const updateDoc = useUpdateDoc()
  const deleteDoc = useDeleteDoc()

  async function save() {
    if (!title.trim()) return
    if (doc === null) {
      await createDoc.mutateAsync({ projectId, doc: { kind, title, content } })
    } else {
      await updateDoc.mutateAsync({ id: doc.id, projectId, patch: { kind, title, content } })
    }
    onClose()
  }

  async function remove() {
    if (doc === null) return
    if (!window.confirm(`"${doc.title}" 문서를 삭제할까요?`)) return
    await deleteDoc.mutateAsync({ id: doc.id, projectId })
    onClose()
  }

  return (
    <div className="overlay" role="dialog" aria-label="문서 편집">
      <div className="overlay-box">
        <div className="overlay-head">
          <input
            aria-label="제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목"
          />
          <select aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button type="button" onClick={() => setPreview((p) => !p)}>
            {preview ? '편집' : '미리보기'}
          </button>
        </div>
        {preview ? (
          <div className="overlay-body">
            <Markdown text={content} />
          </div>
        ) : (
          <textarea
            aria-label="본문"
            className="overlay-body"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}
        <div className="overlay-foot">
          {doc !== null && (
            <button type="button" className="danger" onClick={() => void remove()}>삭제</button>
          )}
          <button type="button" onClick={onClose}>닫기</button>
          <button type="button" className="primary" onClick={() => void save()} disabled={!title.trim()}>
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (40 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DocEditor.tsx web/src/components/DocEditor.test.tsx
git commit -m "feat(web): doc editor overlay - view/edit/create/delete with preview"
```

---

### Task 8: SettleOverlay (정착 검토·수정 플로우)

**Files:**
- Create: `web/src/components/SettleOverlay.tsx`
- Test: `web/src/components/SettleOverlay.test.tsx`

**Interfaces:**
- Consumes: `useProject`/`useCreateDoc`/`useUpdateDoc`(Task 2), `streamSSE`/`ApiError`(Task 3·2), `Markdown`(Task 5).
- Produces:

```ts
interface SettleOverlayProps {
  projectId: number
  threadId: number
  onClose: () => void
}
export function SettleOverlay(props: SettleOverlayProps): JSX.Element
```

3단계 상태 기계:

```
pick(대상 선택: 새 문서 radio 기본 | 기존 문서 radio)
  → [초안 생성] → streaming(POST /settle, target이면 {target_doc_id}, 아니면 {})
       delta 누적 실시간 표시 · [중단]→pick 복귀 · error 이벤트/HTTP 에러→에러 표시+[뒤로]
  → 정상 완료 → edit(제목·종류·본문 편집; target이면 그 문서의 title/kind, 새 문서면 '정착 초안'/'world' 프리필)
       [저장] → 새 문서면 POST /docs, target이면 PUT /docs/{id} → onClose
       [버리기] → confirm → onClose (문서 API 호출 없음 — 서버도 원래 저장 안 함)
```

접근성(테스트 의존): 오버레이 `role="dialog" aria-label="정착"`, radio `새 문서로`/각 문서 제목, 버튼 `초안 생성`/`중단`/`뒤로`/`저장`/`버리기`, edit 단계 입력은 DocEditor와 같은 라벨(`제목`/`종류`/`본문`).

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/components/SettleOverlay.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server, sseResponse } from '../test/msw'
import { renderWithClient } from '../test/utils'
import { makeDocMeta, makeDoc, makeProject } from '../test/fixtures'
import { SettleOverlay } from './SettleOverlay'

function projectHandler() {
  return http.get('/api/projects/1', () =>
    HttpResponse.json({
      project: makeProject({ id: 1 }),
      docs: [makeDocMeta({ id: 2, kind: 'world', title: '세계관 문서' })],
      threads: [],
    }),
  )
}

test('새 문서 플로우: settle {} → 초안 편집 → POST /docs', async () => {
  const onClose = vi.fn()
  let settleBody: unknown = null
  let postBody: unknown = null
  server.use(
    projectHandler(),
    http.post('/api/threads/7/settle', async ({ request }) => {
      settleBody = await request.json()
      return sseResponse([{ delta: '# 세계관\n' }, { delta: '용의 대륙.' }, '[DONE]'])
    }),
    http.post('/api/projects/1/docs', async ({ request }) => {
      postBody = await request.json()
      return HttpResponse.json(makeDoc({ id: 9 }), { status: 201 })
    }),
  )
  renderWithClient(<SettleOverlay projectId={1} threadId={7} onClose={onClose} />)
  expect(await screen.findByLabelText('새 문서로')).toBeChecked() // 기본값
  await userEvent.click(screen.getByRole('button', { name: '초안 생성' }))

  const body = await screen.findByLabelText('본문')
  expect(body).toHaveValue('# 세계관\n용의 대륙.')
  expect(settleBody).toEqual({})
  expect(screen.getByLabelText('제목')).toHaveValue('정착 초안')
  expect(screen.getByLabelText('종류')).toHaveValue('world')

  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() =>
    expect(postBody).toEqual({ kind: 'world', title: '정착 초안', content: '# 세계관\n용의 대륙.' }),
  )
  expect(onClose).toHaveBeenCalled()
})

test('기존 문서 갱신 플로우: {target_doc_id} → 제목·종류 프리필 → PUT', async () => {
  const onClose = vi.fn()
  let settleBody: unknown = null
  let putBody: unknown = null
  server.use(
    projectHandler(),
    http.post('/api/threads/7/settle', async ({ request }) => {
      settleBody = await request.json()
      return sseResponse([{ delta: '갱신된 본문' }, '[DONE]'])
    }),
    http.put('/api/docs/2', async ({ request }) => {
      putBody = await request.json()
      return HttpResponse.json(makeDoc({ id: 2, content: '갱신된 본문' }))
    }),
  )
  renderWithClient(<SettleOverlay projectId={1} threadId={7} onClose={onClose} />)
  await userEvent.click(await screen.findByLabelText('세계관 문서'))
  await userEvent.click(screen.getByRole('button', { name: '초안 생성' }))

  expect(await screen.findByLabelText('제목')).toHaveValue('세계관 문서')
  expect(screen.getByLabelText('종류')).toHaveValue('world')
  expect(settleBody).toEqual({ target_doc_id: 2 })

  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() =>
    expect(putBody).toEqual({ kind: 'world', title: '세계관 문서', content: '갱신된 본문' }),
  )
  expect(onClose).toHaveBeenCalled()
})

test('SSE error 이벤트 → 에러 표시, 편집 단계로 넘어가지 않고 [뒤로]로 복귀', async () => {
  server.use(
    projectHandler(),
    http.post('/api/threads/7/settle', () =>
      sseResponse([{ delta: '부분' }, { error: 'Gemma 응답 실패 (HTTP 500).' }, '[DONE]']),
    ),
  )
  renderWithClient(<SettleOverlay projectId={1} threadId={7} onClose={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: '초안 생성' }))
  expect(await screen.findByText(/Gemma 응답 실패/)).toBeInTheDocument()
  expect(screen.queryByLabelText('본문')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '뒤로' }))
  expect(await screen.findByRole('button', { name: '초안 생성' })).toBeInTheDocument()
})

test('HTTP 413 → detail 표시', async () => {
  const detail = '컨텍스트 초과 예상 (9000/8192 토큰) — 스레드가 너무 길어 통째로 정착할 수 없습니다.'
  server.use(
    projectHandler(),
    http.post('/api/threads/7/settle', () => HttpResponse.json({ detail }, { status: 413 })),
  )
  renderWithClient(<SettleOverlay projectId={1} threadId={7} onClose={() => {}} />)
  await userEvent.click(await screen.findByRole('button', { name: '초안 생성' }))
  expect(await screen.findByText(detail)).toBeInTheDocument()
})

test('버리기: confirm 후 문서 API 호출 없이 닫는다', async () => {
  const onClose = vi.fn()
  let docCalls = 0
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  server.use(
    projectHandler(),
    http.post('/api/threads/7/settle', () => sseResponse([{ delta: '초안' }, '[DONE]'])),
    http.post('/api/projects/1/docs', () => {
      docCalls += 1
      return HttpResponse.json(makeDoc(), { status: 201 })
    }),
    http.put('/api/docs/2', () => {
      docCalls += 1
      return HttpResponse.json(makeDoc())
    }),
  )
  renderWithClient(<SettleOverlay projectId={1} threadId={7} onClose={onClose} />)
  await userEvent.click(await screen.findByRole('button', { name: '초안 생성' }))
  await screen.findByLabelText('본문')
  await userEvent.click(screen.getByRole('button', { name: '버리기' }))
  expect(onClose).toHaveBeenCalled()
  expect(docCalls).toBe(0)
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test -- SettleOverlay`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/components/SettleOverlay.tsx`:

```tsx
import { useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useCreateDoc, useProject, useUpdateDoc } from '../api/hooks'
import { streamSSE } from '../api/sse'
import type { DocKind } from '../api/types'
import { Markdown } from './Markdown'

const KINDS: DocKind[] = ['idea', 'research', 'world', 'note']

interface SettleOverlayProps {
  projectId: number
  threadId: number
  onClose: () => void
}

type Phase =
  | { step: 'pick' }
  | { step: 'streaming'; draft: string; error: string | null }
  | { step: 'edit'; targetDocId: number | null; kind: DocKind; title: string; content: string }

export function SettleOverlay({ projectId, threadId, onClose }: SettleOverlayProps) {
  const { data } = useProject(projectId)
  const createDoc = useCreateDoc()
  const updateDoc = useUpdateDoc()
  const [target, setTarget] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>({ step: 'pick' })
  const abortRef = useRef<AbortController | null>(null)
  const abortedRef = useRef(false)

  const docs = data?.docs ?? []

  async function generate() {
    let draft = ''
    let error: string | null = null
    abortedRef.current = false
    setPhase({ step: 'streaming', draft: '', error: null })
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await streamSSE(
        `/api/threads/${threadId}/settle`,
        target === null ? {} : { target_doc_id: target },
        {
          onDelta: (t) => {
            draft += t
            setPhase({ step: 'streaming', draft, error: null })
          },
          onError: (m) => {
            error = m
          },
        },
        ac.signal,
      )
    } catch (e) {
      error = e instanceof ApiError ? e.detail : '요청에 실패했어요. 서버가 떠 있는지 확인하세요.'
    }
    abortRef.current = null
    if (abortedRef.current) {
      setPhase({ step: 'pick' })
      return
    }
    if (error !== null) {
      setPhase({ step: 'streaming', draft, error })
      return
    }
    const targetMeta = target !== null ? docs.find((d) => d.id === target) : undefined
    setPhase({
      step: 'edit',
      targetDocId: target,
      kind: targetMeta?.kind ?? 'world',
      title: targetMeta?.title ?? '정착 초안',
      content: draft,
    })
  }

  function stop() {
    abortedRef.current = true
    abortRef.current?.abort()
  }

  async function save(p: Extract<Phase, { step: 'edit' }>) {
    if (!p.title.trim()) return
    if (p.targetDocId === null) {
      await createDoc.mutateAsync({
        projectId,
        doc: { kind: p.kind, title: p.title, content: p.content },
      })
    } else {
      await updateDoc.mutateAsync({
        id: p.targetDocId,
        projectId,
        patch: { kind: p.kind, title: p.title, content: p.content },
      })
    }
    onClose()
  }

  function discard() {
    if (window.confirm('초안을 버릴까요? 저장되지 않습니다.')) onClose()
  }

  return (
    <div className="overlay" role="dialog" aria-label="정착">
      <div className="overlay-box">
        {phase.step === 'pick' && (
          <>
            <h3>대화를 어디에 정착할까요?</h3>
            <div className="settle-pick overlay-body">
              <label>
                <input
                  type="radio"
                  name="settle-target"
                  aria-label="새 문서로"
                  checked={target === null}
                  onChange={() => setTarget(null)}
                />
                새 문서로
              </label>
              {docs.map((d) => (
                <label key={d.id}>
                  <input
                    type="radio"
                    name="settle-target"
                    aria-label={d.title}
                    checked={target === d.id}
                    onChange={() => setTarget(d.id)}
                  />
                  <span className={`kind kind-${d.kind}`}>{d.kind}</span> {d.title}
                </label>
              ))}
            </div>
            <div className="overlay-foot">
              <button type="button" onClick={onClose}>닫기</button>
              <button type="button" className="primary" onClick={() => void generate()}>
                초안 생성
              </button>
            </div>
          </>
        )}
        {phase.step === 'streaming' && (
          <>
            <h3>초안 생성 중…</h3>
            <div className="overlay-body">
              <Markdown text={phase.draft} />
              {phase.error !== null && <p className="settle-error">{phase.error}</p>}
            </div>
            <div className="overlay-foot">
              {phase.error === null ? (
                <button type="button" onClick={stop}>중단</button>
              ) : (
                <button type="button" onClick={() => setPhase({ step: 'pick' })}>뒤로</button>
              )}
            </div>
          </>
        )}
        {phase.step === 'edit' && (
          <>
            <div className="overlay-head">
              <input
                aria-label="제목"
                value={phase.title}
                onChange={(e) => setPhase({ ...phase, title: e.target.value })}
              />
              <select
                aria-label="종류"
                value={phase.kind}
                onChange={(e) => setPhase({ ...phase, kind: e.target.value as DocKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <textarea
              aria-label="본문"
              className="overlay-body"
              value={phase.content}
              onChange={(e) => setPhase({ ...phase, content: e.target.value })}
            />
            <div className="overlay-foot">
              <button type="button" className="danger" onClick={discard}>버리기</button>
              <button
                type="button"
                className="primary"
                onClick={() => void save(phase)}
                disabled={!phase.title.trim()}
              >
                저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

구현 노트: 스트리밍 중 draft는 로컬 변수에 누적하고 매 delta마다 setPhase로 통째로 교체한다(스테일 클로저 방지). edit 단계의 마크다운 미리보기는 넣지 않는다 — 저장 후 DocEditor에서 볼 수 있고, 초안 검토의 본질은 텍스트 수정이다(YAGNI).

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (45 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SettleOverlay.tsx web/src/components/SettleOverlay.test.tsx
git commit -m "feat(web): settle overlay - target pick, draft stream, review/edit, save"
```

---

### Task 9: App 배선 (선택 상태 + 오버레이 스위치)

**Files:**
- Modify: `web/src/App.tsx` (임시 셸 → 진짜 배선)
- Modify: `web/src/App.test.tsx` (스모크 → 통합 테스트로 전체 교체)

**Interfaces:**
- Consumes: Task 4~8의 컴포넌트 전부 (props 형태는 각 태스크 Interfaces 블록이 정본).
- Produces: 완성된 UI. `docSelection: Record<number, number[] | null>` — 스레드별 문서 체크 상태(메모리, 새로고침 시 전체 선택으로 리셋).

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/App.test.tsx` (전체 교체 — 파일이 `web/src/`에 있으므로 임포트 경로는 `./test/…`):

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from './test/msw'
import { renderWithClient } from './test/utils'
import { makeBudget, makeDoc, makeDocMeta, makeMessage, makeProject, makeThread, makeThreadMeta } from './test/fixtures'
import App from './App'

function baseHandlers() {
  return [
    http.get('/api/health', () => HttpResponse.json({ ok: true, gemma: true })),
    http.get('/api/projects', () => HttpResponse.json([makeProject({ id: 1, name: '아틀라스' })])),
    http.get('/api/projects/1', () =>
      HttpResponse.json({
        project: makeProject({ id: 1, name: '아틀라스' }),
        docs: [makeDocMeta({ id: 2, kind: 'world', title: '세계관 문서' })],
        threads: [makeThreadMeta({ id: 7, title: '용 대화' })],
      }),
    ),
    http.get('/api/threads/7', () =>
      HttpResponse.json({
        thread: makeThread({ id: 7, title: '용 대화' }),
        messages: [makeMessage({ id: 1, role: 'user', content: '용 얘기' })],
      }),
    ),
    http.get('/api/threads/7/budget', () => HttpResponse.json(makeBudget())),
    http.get('/api/docs/2', () => HttpResponse.json(makeDoc({ id: 2, kind: 'world', title: '세계관 문서', content: '# 대륙' }))),
  ]
}

test('프로젝트 → 스레드 → 챗+문서패널, 문서 클릭 → 편집 오버레이', async () => {
  server.use(...baseHandlers())
  renderWithClient(<App />)
  expect(screen.getByText('프로젝트를 선택하거나 만들어서 시작하세요.')).toBeInTheDocument()

  await userEvent.click(await screen.findByText('아틀라스'))
  expect(await screen.findByText('스레드를 선택하거나 만들어서 시작하세요.')).toBeInTheDocument()
  expect(await screen.findByText('세계관 문서')).toBeInTheDocument() // 문서 패널

  await userEvent.click(screen.getByText('용 대화'))
  expect(await screen.findByLabelText('메시지 입력')).toBeInTheDocument()
  expect(await screen.findByText('용 얘기')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText(/tok \(/)).toBeInTheDocument()) // 예산 게이지

  await userEvent.click(screen.getByText('세계관 문서'))
  expect(await screen.findByRole('dialog', { name: '문서 편집' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '닫기' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '문서 편집' })).not.toBeInTheDocument(),
  )
})

test('정착 버튼 → 정착 오버레이', async () => {
  server.use(...baseHandlers())
  renderWithClient(<App />)
  await userEvent.click(await screen.findByText('아틀라스'))
  await userEvent.click(await screen.findByText('용 대화'))
  await userEvent.click(await screen.findByRole('button', { name: '정착' }))
  expect(await screen.findByRole('dialog', { name: '정착' })).toBeInTheDocument()
})

test('프로젝트를 바꾸면 스레드 선택이 풀린다', async () => {
  // MSW는 같은 use() 배열 안에서 앞선 핸들러가 이기므로, 오버라이드를 baseHandlers보다 먼저 둔다
  server.use(
    http.get('/api/projects', () =>
      HttpResponse.json([makeProject({ id: 1, name: '아틀라스' }), makeProject({ id: 3, name: '차크', slug: 'c' })]),
    ),
    http.get('/api/projects/3', () =>
      HttpResponse.json({ project: makeProject({ id: 3, name: '차크', slug: 'c' }), docs: [], threads: [] }),
    ),
    ...baseHandlers(),
  )
  renderWithClient(<App />)
  await userEvent.click(await screen.findByText('아틀라스'))
  await userEvent.click(await screen.findByText('용 대화'))
  await screen.findByLabelText('메시지 입력')
  await userEvent.click(screen.getByText('차크'))
  expect(await screen.findByText('스레드를 선택하거나 만들어서 시작하세요.')).toBeInTheDocument()
})
```

(첫 코드 블록의 잘못된 임포트 예시는 쓰지 말 것 — 두 번째 블록이 정본이다.)

- [ ] **Step 2: 실패 확인**

Run: `cd web && npm test -- App`
Expected: FAIL — 셸 App에는 사이드바가 없다.

- [ ] **Step 3: 구현**

`web/src/App.tsx` (전체 교체):

```tsx
import { useState } from 'react'
import { ChatPane } from './components/ChatPane'
import { DocEditor } from './components/DocEditor'
import { DocsPanel } from './components/DocsPanel'
import { SettleOverlay } from './components/SettleOverlay'
import { Sidebar } from './components/Sidebar'

type Overlay = { kind: 'doc'; docId: number | 'new' } | { kind: 'settle' } | null

export default function App() {
  const [projectId, setProjectId] = useState<number | null>(null)
  const [threadId, setThreadId] = useState<number | null>(null)
  // 스레드별 문서 체크 상태 (null = 전체 선택) — 메모리 전용, 새로고침 시 리셋
  const [docSelection, setDocSelection] = useState<Record<number, number[] | null>>({})
  const [overlay, setOverlay] = useState<Overlay>(null)

  const docIds = threadId !== null ? (docSelection[threadId] ?? null) : null

  function selectProject(id: number | null) {
    setProjectId(id)
    setThreadId(null)
  }

  return (
    <div className="app">
      <Sidebar
        selectedProjectId={projectId}
        selectedThreadId={threadId}
        onSelectProject={selectProject}
        onSelectThread={setThreadId}
      />
      <main className="chat">
        {threadId !== null ? (
          <ChatPane key={threadId} threadId={threadId} docIds={docIds} />
        ) : (
          <p className="placeholder">
            {projectId === null
              ? '프로젝트를 선택하거나 만들어서 시작하세요.'
              : '스레드를 선택하거나 만들어서 시작하세요.'}
          </p>
        )}
      </main>
      {projectId !== null ? (
        <DocsPanel
          projectId={projectId}
          threadId={threadId}
          docIds={docIds}
          onChangeDocIds={(ids) => {
            if (threadId !== null) setDocSelection((s) => ({ ...s, [threadId]: ids }))
          }}
          onOpenDoc={(docId) => setOverlay({ kind: 'doc', docId })}
          onSettle={() => setOverlay({ kind: 'settle' })}
        />
      ) : (
        <aside className="docs-panel" />
      )}
      {overlay?.kind === 'doc' && projectId !== null && (
        <DocEditor projectId={projectId} docId={overlay.docId} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'settle' && projectId !== null && threadId !== null && (
        <SettleOverlay projectId={projectId} threadId={threadId} onClose={() => setOverlay(null)} />
      )}
    </div>
  )
}
```

`ChatPane`에 `key={threadId}`를 주어 스레드 전환 시 입력/스트리밍 로컬 상태를 리셋한다.

- [ ] **Step 4: 통과 확인**

Run: `cd web && npm run typecheck && npm test`
Expected: PASS (스모크 1개가 통합 3개로 바뀌어 총 47 passed)

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): app wiring - selection state, overlays, thread-scoped doc checks"
```

---

### Task 10: FastAPI가 web/dist 서빙 + 문서 갱신 + 최종 검증

**Files:**
- Modify: `server/main.py` (구 web/ 마운트 → `web/dist`; **API 라우트는 그대로**)
- Test: `tests/test_static.py`
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: Task 1~9의 완성된 web/ (빌드 산출물 `web/dist`).
- Produces: `GET /` → dist/index.html (있을 때), `/assets/*` 정적 서빙. dist 없으면(테스트/새 클론) 비-API 경로 404 — 서버는 뜬다.

- [ ] **Step 1: 실패하는 백엔드 테스트 작성**

`tests/test_static.py`:

```python
"""web/dist 서빙 — dist 유무와 무관하게 결정론적으로 검증한다.

StaticFiles는 all_directories를 __init__에서 굳히므로, 실제 web/dist 존재 여부에
테스트가 좌우되지 않도록 그 속성을 tmp_path로 바꿔치기해 두 경우를 모두 재현한다.
"""


def _static_app():
    from server.main import app

    for route in app.routes:
        if getattr(route, "name", None) == "web":
            return route.app
    raise AssertionError("web mount not found")


def test_api_routes_not_shadowed_by_root_mount(client):
    assert client.get("/api/projects").status_code == 200


def test_root_404_when_dist_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(_static_app(), "all_directories", [str(tmp_path / "no-dist")])
    assert client.get("/").status_code == 404


def test_root_serves_index_when_dist_exists(client, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>atlas</title>", encoding="utf-8")
    monkeypatch.setattr(_static_app(), "all_directories", [str(tmp_path)])
    r = client.get("/")
    assert r.status_code == 200
    assert "atlas" in r.text
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_static.py -v`
Expected: FAIL — `web` 이름의 마운트 없음 (`AssertionError: web mount not found`).

- [ ] **Step 3: server/main.py 수정**

세 군데:

1. import에서 `FileResponse` 제거 (StreamingResponse만 남김):

```python
from fastapi.responses import StreamingResponse
```

2. `WEB_DIR = ...` 줄을 다음으로 교체:

```python
DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"
```

3. 파일 끝의 `@app.get("/") def index()` 라우트와 `app.mount("/static", ...)` 줄을 삭제하고 다음으로 교체:

```python
# 빌드된 프론트(web/dist) 서빙 — dist가 없으면(개발·테스트) 비-API 경로는 404, 서버는 정상 기동.
# 마운트는 라우트 테이블 마지막에 매칭되므로 /api/*를 가리지 않는다.
app.mount("/", StaticFiles(directory=DIST_DIR, html=True, check_dir=False), name="web")
```

- [ ] **Step 4: 백엔드 전체 통과 확인**

Run: `uv run pytest`
Expected: 65 passed (기존 62 + 신규 3), 0 warnings. `grep -rn "WEB_DIR\|FileResponse\|/static" server/` 결과 없음.

- [ ] **Step 5: 프로덕션 빌드 확인 (서버 기동 없이)**

```bash
cd web && npm run build
ls dist/index.html dist/assets
```

Expected: 빌드 성공, dist/index.html 존재. (dist는 web/.gitignore로 커밋되지 않는다.)

- [ ] **Step 6: 문서 갱신**

`CLAUDE.md` 아키텍처 섹션의 `web/` 불릿을 다음으로 교체:

```markdown
- `web/` — React+Vite+TS(strict) UI. 3판 워크스페이스(사이드바/챗/문서 패널) +
  문서 편집·정착 오버레이. dev는 5173(`cd web && npm run dev`, `/api`→8787 프록시),
  프로덕션은 `npm run build` 후 FastAPI가 `web/dist`를 서빙 (dist 없으면 비-API 경로 404).
  테스트: `cd web && npm test` — vitest+RTL+MSW, 모킹 누락 시 즉시 실패(onUnhandledRequest:
  'error')라 8787/8080을 절대 치지 않는다.
```

`CLAUDE.md` 실행 섹션을 다음으로 교체:

```markdown
## 실행

```bash
# 백엔드 (8787)
uv run uvicorn server.main:app --host 0.0.0.0 --port 8787
# 프론트 dev (5173, /api → 8787 프록시)
cd web && npm run dev
# 프로덕션: 빌드하면 8787 하나로 서빙
cd web && npm run build
```
```

`CLAUDE.md` 테스트 언급(`uv run pytest` 불릿)에 프론트 명령 추가: `uv run pytest` + `cd web && npm run typecheck && npm test`.

`README.md`의 실행/테스트 부분에도 같은 내용을 반영한다 (기존 문구 스타일 유지, 간결하게).

- [ ] **Step 7: 최종 검증 (NO LIVE 확인 포함)**

```bash
uv run pytest                                   # 65 passed, 0 warnings
ATLAS_LLAMA_BASE=http://127.0.0.1:1 uv run pytest   # 동일 결과 — 죽은 포트로도 전부 통과
cd web && npm run typecheck && npm test          # 47 passed
```

- [ ] **Step 8: Commit**

```bash
git add server/main.py tests/test_static.py CLAUDE.md README.md
git commit -m "feat: serve web/dist from fastapi; docs for react ui"
```

---

## 플랜 셀프 리뷰 결과 (작성 시 반영 완료)

- 스펙 커버리지: 스택·구조=T1, API 레이어=T2, SSE=T3, 사이드바(스레드 UI)=T4, 마크다운 챗=T5, 체크박스+예산 게이지=T6, 문서 편집기=T7, 정착 플로우=T8, 3판 배선·스레드별 체크 상태=T9, dist 서빙+문서=T10. 스펙 "범위 밖" 항목은 어느 태스크에도 없음.
- 타입/시그니처 일치: `docIds: number[] | null`(null=전체) 시맨틱이 hooks·ChatPane·DocsPanel·App에서 동일. DocEditor·SettleOverlay의 폼 라벨(`제목`/`종류`/`본문`) 공유. 테스트 수 누계(8→14→19→25→36→40→45→47)는 추정치 — 어긋나도 전체 green이면 무방.
- 알려진 유의점(구현자가 그대로 따르면 됨): ① 테스트 setup의 fetch 상대경로 심은 undici가 상대 URL을 못 받아서다. ② Task 10의 `all_directories` 몽키패치는 StaticFiles 내부 속성에 의존한다 — starlette 버전업 시 테스트만 고치면 된다. ③ 라이브러리는 설치 시점 최신을 쓰므로 플랜 코드와 사소한 API 차이가 나면 SDD 원칙대로 편차를 원장에 기록하고 진행한다.





