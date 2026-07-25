# 반응형·디폴트 선택·활동순 정렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 열자마자 최신 대화가 보이고(PC 디폴트 선택 + 활동순 정렬), 모바일(≤768px)에서 목록→채팅 드릴다운으로 쓸 수 있게 한다.

**Architecture:** 백엔드는 목록 쿼리 ORDER BY만 교체(스키마 변경 없음). 프론트는 라우터 없이 `useIsMobile()`(matchMedia) + App의 `mobileView` 상태('home'|'chat')로 화면을 전환하고, 채팅 진입 시 `history.pushState`로 폰 백 제스처를 지원한다. 문서 패널은 모바일에서 하단 시트로 DocsPanel을 재사용한다.

**Tech Stack:** FastAPI+SQLite / React+TS(strict)+react-query / vitest+RTL+MSW / pytest

**Spec:** `docs/superpowers/specs/2026-07-26-web-responsive-defaults-design.md`

## Global Constraints

- 테스트는 `uv run pytest`(repo 루트), `cd web && bun run typecheck && bun run test` — `bun test` 금지(vitest 설정 안 탐).
- llama-server(8080)를 절대 직접 치지 않는다 — 서버 테스트는 기존 모킹 패턴 유지.
- MSW `onUnhandledRequest: 'error'` — 새 네트워크 호출은 반드시 핸들러 추가.
- 스키마 변경 금지(`PRAGMA user_version` 유지). API 응답에 새 필드를 노출하지 않는다.
- 기존 웹 테스트 50개는 (이 계획이 명시적으로 수정하는 것 외에) 계속 통과해야 한다.

---

### Task 1: 백엔드 활동순 정렬

**Files:**
- Modify: `server/main.py:81-85` (list_projects), `server/main.py:117-120` (get_project의 threads 쿼리)
- Test: `tests/test_projects.py`, `tests/test_threads.py`

**Interfaces:**
- Produces: `GET /api/projects` 가 마지막 활동(하위 메시지·문서 updated_at·프로젝트 created_at 중 최신) 내림차순. `GET /api/projects/{id}` 의 `threads` 가 마지막 메시지(없으면 created_at) 내림차순. 응답 형태(필드)는 불변.
- 동점(같은 초)일 때는 id DESC.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_threads.py` 에 추가:

```python
def test_threads_ordered_by_last_activity(client):
    p = client.post("/api/projects", json={"name": "정렬"}).json()
    t1 = client.post(f"/api/projects/{p['id']}/threads", json={"title": "옛날"}).json()
    t2 = client.post(f"/api/projects/{p['id']}/threads", json={"title": "최신생성"}).json()

    # 생성순 동점(같은 초) → id DESC: t2 먼저
    ids = [t["id"] for t in client.get(f"/api/projects/{p['id']}").json()["threads"]]
    assert ids == [t2["id"], t1["id"]]

    # t1에 "더 최근" 메시지가 생기면 t1이 위로 — 타임스탬프를 직접 심는다
    from server import db
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO messages (thread_id, role, content, created_at) VALUES (?, 'user', '안녕', datetime('now', '+1 hour'))",
            (t1["id"],),
        )
    ids = [t["id"] for t in client.get(f"/api/projects/{p['id']}").json()["threads"]]
    assert ids == [t1["id"], t2["id"]]
```

`tests/test_projects.py` 에 추가:

```python
def test_projects_ordered_by_last_activity(client):
    p1 = client.post("/api/projects", json={"name": "먼저"}).json()
    p2 = client.post("/api/projects", json={"name": "나중"}).json()

    # 생성 동점 → id DESC: p2 먼저
    assert [p["id"] for p in client.get("/api/projects").json()] == [p2["id"], p1["id"]]

    # p1 쪽 스레드에 미래 메시지 → p1이 위로
    t = client.post(f"/api/projects/{p1['id']}/threads", json={"title": "t"}).json()
    from server import db
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO messages (thread_id, role, content, created_at) VALUES (?, 'user', '안녕', datetime('now', '+1 hour'))",
            (t["id"],),
        )
    assert [p["id"] for p in client.get("/api/projects").json()] == [p1["id"], p2["id"]]

    # p2 쪽 문서를 더 미래로 갱신 → p2가 다시 위로
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO docs (project_id, kind, title, content, created_at, updated_at) VALUES (?, 'note', 'n', '', datetime('now'), datetime('now', '+2 hour'))",
            (p2["id"],),
        )
    assert [p["id"] for p in client.get("/api/projects").json()] == [p2["id"], p1["id"]]
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_threads.py::test_threads_ordered_by_last_activity tests/test_projects.py::test_projects_ordered_by_last_activity -v`
Expected: FAIL (순서 불일치 — 현재는 id DESC 고정)

- [ ] **Step 3: 쿼리 교체**

`server/main.py` list_projects:

```python
rows = conn.execute(
    """
    SELECT p.* FROM projects p
    LEFT JOIN (SELECT project_id, MAX(updated_at) AS at FROM docs GROUP BY project_id) d
      ON d.project_id = p.id
    LEFT JOIN (
      SELECT t.project_id, MAX(m.created_at) AS at
      FROM threads t JOIN messages m ON m.thread_id = t.id
      GROUP BY t.project_id
    ) m ON m.project_id = p.id
    ORDER BY MAX(p.created_at, COALESCE(d.at, p.created_at), COALESCE(m.at, p.created_at)) DESC,
             p.id DESC
    """
).fetchall()
```

get_project의 threads 쿼리:

```python
threads = conn.execute(
    """
    SELECT t.id, t.title, t.archived, t.created_at FROM threads t
    LEFT JOIN (SELECT thread_id, MAX(created_at) AS at FROM messages GROUP BY thread_id) m
      ON m.thread_id = t.id
    WHERE t.project_id = ?
    ORDER BY COALESCE(m.at, t.created_at) DESC, t.id DESC
    """,
    (project_id,),
).fetchall()
```

- [ ] **Step 4: 전체 서버 테스트 통과 확인**

Run: `uv run pytest`
Expected: 전부 PASS (기존 테스트 중 목록 순서를 생성순으로 단정한 게 있으면 이 정렬 규칙에 맞게 수정 — 동점은 id DESC라 대부분 그대로 통과)

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_projects.py tests/test_threads.py
git commit -m "feat(server): order projects/threads by last activity"
```

---

### Task 2: 스크롤바 커스텀 (CSS만)

**Files:**
- Modify: `web/src/styles.css` (`:root` 블록 아래에 전역 규칙 추가)

**Interfaces:** 없음 (시각만). 테스트 없음 — jsdom은 스크롤바를 렌더하지 않는다.

- [ ] **Step 1: CSS 추가**

`styles.css` 의 `body { ... }` 규칙 다음에:

```css
/* ---- 스크롤바 ---- */
* { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }
*::-webkit-scrollbar-thumb:hover { background: #3d4150; }
```

- [ ] **Step 2: 확인 및 커밋**

Run: `cd web && bun run typecheck && bun run test` (기존 50개 통과 확인)

```bash
git add web/src/styles.css
git commit -m "feat(web): themed thin scrollbars"
```

---

### Task 3: matchMedia 테스트 인프라 + useIsMobile 훅

**Files:**
- Create: `web/src/useIsMobile.ts`
- Modify: `web/src/test/setup.ts` (matchMedia 모킹 추가)
- Test: `web/src/useIsMobile.test.ts`

**Interfaces:**
- Produces: `useIsMobile(): boolean` — `(max-width: 768px)` 매치 여부, 리스너로 실시간 갱신.
- Produces(테스트용): `setup.ts` 가 `window.matchMedia` 를 모킹. 전역 `(globalThis as any).__vpMobile: boolean` 플래그(기본 false=데스크톱)를 읽는다. 각 테스트 후 자동으로 false 리셋.

- [ ] **Step 1: setup.ts 에 matchMedia 모킹 추가**

`web/src/test/setup.ts` 에 추가 (기존 내용 유지):

```ts
// jsdom엔 matchMedia가 없다 — __vpMobile 플래그 기반 모킹 (기본: 데스크톱)
beforeEach(() => {
  ;(globalThis as any).__vpMobile = false
})
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    get matches() {
      return query.includes('max-width') && (globalThis as any).__vpMobile === true
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
```

(`beforeEach`는 vitest globals 설정에 따라 `import { beforeEach } from 'vitest'` 필요.)

- [ ] **Step 2: 실패하는 훅 테스트 작성**

`web/src/useIsMobile.test.ts`:

```ts
import { renderHook } from '@testing-library/react'
import { useIsMobile } from './useIsMobile'

test('데스크톱(기본)에서는 false', () => {
  const { result } = renderHook(() => useIsMobile())
  expect(result.current).toBe(false)
})

test('모바일 플래그가 켜져 있으면 true', () => {
  ;(globalThis as any).__vpMobile = true
  const { result } = renderHook(() => useIsMobile())
  expect(result.current).toBe(true)
})
```

Run: `cd web && bun run test useIsMobile` — Expected: FAIL (모듈 없음)

- [ ] **Step 3: 훅 구현**

`web/src/useIsMobile.ts`:

```ts
import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 768px)'

function subscribe(cb: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches)
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `cd web && bun run typecheck && bun run test`
Expected: 전부 PASS

```bash
git add web/src/useIsMobile.ts web/src/useIsMobile.test.ts web/src/test/setup.ts
git commit -m "feat(web): useIsMobile hook + matchMedia test shim"
```

---

### Task 4: PC 디폴트 선택 (첫 프로젝트·최신 스레드)

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx` (기존 테스트 1·3번 전제 수정 + 신규 테스트)

**Interfaces:**
- Consumes: `useProjects()`, `useProject(id)` (`web/src/api/hooks.ts` 기존 훅 — react-query 캐시 공유라 Sidebar와 중복 호출돼도 요청은 1번).
- Produces: App 로드 시 `projectId`가 null이거나 목록에 없으면 목록 첫 항목으로, `threadId`가 null이면 첫 **비아카이브** 스레드로 설정된다. 사용자가 고른 유효한 선택은 건드리지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/App.test.tsx` 에 추가:

```tsx
test('로드하면 첫 프로젝트·최신 스레드가 자동 선택된다', async () => {
  server.use(...baseHandlers())
  renderWithClient(<App />)
  // 클릭 없이 채팅이 바로 열린다
  expect(await screen.findByLabelText('메시지 입력')).toBeInTheDocument()
  expect(await screen.findByText('용 얘기')).toBeInTheDocument()
})

test('아카이브 스레드는 디폴트 선택에서 제외된다', async () => {
  server.use(
    http.get('/api/projects/1', () =>
      HttpResponse.json({
        project: makeProject({ id: 1, name: '아틀라스' }),
        docs: [],
        threads: [
          makeThreadMeta({ id: 9, title: '보관됨', archived: 1 }),
          makeThreadMeta({ id: 7, title: '용 대화' }),
        ],
      }),
    ),
    ...baseHandlers(),
  )
  renderWithClient(<App />)
  await screen.findByLabelText('메시지 입력')
  // 살아있는 스레드(용 대화)가 선택됨 — 사이드바 active 확인
  expect((await screen.findByText('용 대화')).closest('li')).toHaveClass('active')
})
```

기존 테스트 수정:
- 1번 테스트: 첫 줄의 `expect(screen.getByText('프로젝트를 선택하거나 만들어서 시작하세요.')).toBeInTheDocument()` 삭제, `await userEvent.click(await screen.findByText('아틀라스'))` 와 `'용 대화'` 클릭도 삭제 (자동 선택되므로 바로 `findByLabelText('메시지 입력')` 대기). "스레드를 선택하거나" 단언도 삭제.
- 3번 테스트(프로젝트를 바꾸면 스레드 선택이 풀린다): 클릭 시퀀스는 유지하되 첫 클릭(`아틀라스`)은 이미 선택돼 있어도 무해하므로 그대로 둬도 된다. 마지막 단언(차크 선택 후 placeholder)은 차크에 스레드가 없으므로 그대로 유효.

Run: `cd web && bun run test App` — Expected: 신규 2개 FAIL

- [ ] **Step 2: App.tsx 에 디폴트 선택 이펙트 추가**

```tsx
import { useEffect, useState } from 'react'
import { useProject, useProjects } from './api/hooks'
// ...
const projects = useProjects()
const detail = useProject(projectId)

// 디폴트 선택: 선택이 없거나(삭제 등으로) 무효해졌을 때만 개입한다
useEffect(() => {
  const list = projects.data
  if (!list) return
  if (projectId === null || !list.some((p) => p.id === projectId)) {
    setProjectId(list[0]?.id ?? null)
    setThreadId(null)
  }
}, [projects.data, projectId])

useEffect(() => {
  const threads = detail.data?.threads
  if (!threads || threadId !== null) return
  const first = threads.find((t) => !t.archived)
  if (first) setThreadId(first.id)
}, [detail.data, threadId])
```

주의: `ThreadMeta.archived` 타입이 number(0/1)면 `!t.archived` 그대로 동작. 스레드 삭제로 threadId가 무효해지는 경우는 기존 Sidebar가 `onSelectThread(null)`을 호출하므로 이 이펙트가 다음 렌더에서 잡는다.

- [ ] **Step 3: 통과 확인**

Run: `cd web && bun run typecheck && bun run test`
Expected: 전부 PASS (수정한 기존 테스트 포함)

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): auto-select first project and latest thread on load"
```

---

### Task 5: 모바일 드릴다운 + 하단 시트

**Files:**
- Modify: `web/src/App.tsx` (isMobile 분기, mobileView 상태, pushState/popstate, 시트 상태)
- Modify: `web/src/components/ChatPane.tsx` (chat-head에 뒤로·문서 버튼 — props 추가)
- Modify: `web/src/styles.css` (모바일 미디어쿼리 + 시트 스타일)
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `useIsMobile()`, `(globalThis as any).__vpMobile` 테스트 플래그.
- Produces: `ChatPane` props 확장 — `onBack?: () => void`, `onOpenDocs?: () => void` (있을 때만 버튼 렌더, 기존 호출부는 무변경으로 동작).

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/App.test.tsx` 에 추가:

```tsx
test('모바일: 목록에서 스레드를 탭해야 채팅으로, 뒤로가면 목록', async () => {
  ;(globalThis as any).__vpMobile = true
  server.use(...baseHandlers())
  renderWithClient(<App />)

  // home: 목록만 보이고 채팅 입력은 없다 (디폴트 스레드는 하이라이트만)
  expect((await screen.findByText('용 대화')).closest('li')).toHaveClass('active')
  expect(screen.queryByLabelText('메시지 입력')).not.toBeInTheDocument()

  // 탭 → 채팅 진입
  await userEvent.click(screen.getByText('용 대화'))
  expect(await screen.findByLabelText('메시지 입력')).toBeInTheDocument()

  // 뒤로 → home 복귀
  await userEvent.click(screen.getByRole('button', { name: '목록으로' }))
  expect(await screen.findByText('프로젝트')).toBeInTheDocument()
  expect(screen.queryByLabelText('메시지 입력')).not.toBeInTheDocument()
})

test('모바일: 문서 버튼 → 하단 시트(정착 버튼 포함)', async () => {
  ;(globalThis as any).__vpMobile = true
  server.use(...baseHandlers())
  renderWithClient(<App />)
  await userEvent.click(await screen.findByText('용 대화'))
  await userEvent.click(await screen.findByRole('button', { name: '문서 패널 열기' }))
  expect(await screen.findByRole('button', { name: '정착' })).toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('시트 닫기'))
  await waitFor(() => expect(screen.queryByRole('button', { name: '정착' })).not.toBeInTheDocument())
})
```

Run: `cd web && bun run test App` — Expected: FAIL

- [ ] **Step 2: ChatPane 헤더 버튼**

`ChatPane` props에 `onBack`/`onOpenDocs` 추가, 헤더 교체:

```tsx
interface ChatPaneProps {
  threadId: number
  docIds: number[] | null
  onBack?: () => void
  onOpenDocs?: () => void
}
// ...
<header className="chat-head">
  {onBack && <button className="icon-btn" aria-label="목록으로" onClick={onBack}>←</button>}
  <h2>{data?.thread.title ?? ''}</h2>
  {onOpenDocs && (
    <button className="icon-btn" aria-label="문서 패널 열기" onClick={onOpenDocs}>☰</button>
  )}
</header>
```

- [ ] **Step 3: App 모바일 분기**

`App.tsx`:

```tsx
const isMobile = useIsMobile()
const [mobileView, setMobileView] = useState<'home' | 'chat'>('home')
const [sheetOpen, setSheetOpen] = useState(false)

useEffect(() => {
  function onPop() {
    setMobileView('home')
    setSheetOpen(false)
  }
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}, [])

function openThread(id: number | null) {
  setThreadId(id)
  if (isMobile && id !== null) {
    history.pushState({ view: 'chat' }, '')
    setMobileView('chat')
  }
}
```

- Sidebar에는 `onSelectThread={openThread}` 를 넘긴다 (PC에선 pushState 없이 기존과 동일).
- 렌더: `isMobile && mobileView === 'home'` → `<div className="app mobile"><Sidebar ... /></div>` (chat/docs-panel 미렌더). `isMobile && mobileView === 'chat'` → 챗만 풀스크린, `<ChatPane onBack={() => history.back()} onOpenDocs={() => setSheetOpen(true)} ... />`, 시트:

```tsx
{sheetOpen && projectId !== null && (
  <div className="sheet-backdrop" role="presentation">
    <button aria-label="시트 닫기" className="sheet-close" onClick={() => setSheetOpen(false)} />
    <div className="sheet">
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
    </div>
  </div>
)}
```

- 데스크톱 렌더는 기존 3판 그대로. 오버레이(DocEditor/SettleOverlay)는 두 모드 공통 렌더 유지.
- 주의: 모바일 chat 뷰에서 threadId가 null이 되면(스레드 삭제) `setMobileView('home')` 으로 돌린다 — `openThread(null)` 경로와 Sidebar 삭제 콜백이 이를 커버하는지 확인.

- [ ] **Step 4: CSS 미디어쿼리 + 시트**

`styles.css` 끝에:

```css
/* ---- 모바일 (≤768px) ---- */
@media (max-width: 768px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { border-right: none; }
  .chat-head { display: flex; align-items: center; gap: 10px; }
  .icon-btn {
    background: none; border: 1px solid var(--line); color: var(--text);
    border-radius: 6px; width: 30px; height: 30px; flex-shrink: 0;
  }
  .chat-head h2 { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
.sheet-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 9; }
.sheet-close { position: absolute; inset: 0; background: none; border: none; }
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0; max-height: 70dvh;
  background: var(--panel); border-top: 1px solid var(--line);
  border-radius: 16px 16px 0 0; display: flex; overflow: hidden;
}
.sheet .docs-panel { flex: 1; border-left: none; }
```

(`.icon-btn`은 미디어쿼리 밖에 둬도 되지만 PC에선 버튼 자체가 렌더되지 않으므로 무관.)

- [ ] **Step 5: 전체 확인 + 커밋**

Run: `cd web && bun run typecheck && bun run test`
Expected: 전부 PASS (기존 + 신규)

```bash
git add web/src/App.tsx web/src/App.test.tsx web/src/components/ChatPane.tsx web/src/styles.css
git commit -m "feat(web): mobile drill-down layout with docs bottom sheet"
```

---

### Task 6: 전체 검증 + 프로덕션 배포

**Files:** 없음 (검증·배포만)

- [ ] **Step 1: 전체 테스트**

Run: `uv run pytest && cd web && bun run typecheck && bun run test`
Expected: 전부 PASS

- [ ] **Step 2: 빌드 + 서버 재시작**

```bash
cd /Users/arden/code/atlas/web && bun run build
launchctl kickstart -k gui/501/com.arden.atlas-server
curl -s --max-time 5 http://127.0.0.1:8787/api/health
```

Expected: `{"ok":true,...}`

- [ ] **Step 3: 실기기 확인 요청**

사용자에게: PC 새로고침 → 최신 스레드 자동 선택 확인, 폰에서 atlas.ardenspace.com → 목록→채팅 드릴다운·하단 시트·백 제스처 확인을 요청한다.
