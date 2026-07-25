import { useEffect, useState } from 'react'
import { useProject, useProjects } from './api/hooks'
import { ChatPane } from './components/ChatPane'
import { DocEditor } from './components/DocEditor'
import { DocsPanel } from './components/DocsPanel'
import { SettleOverlay } from './components/SettleOverlay'
import { Sidebar } from './components/Sidebar'
import { useIsMobile } from './useIsMobile'

type Overlay = { kind: 'doc'; docId: number | 'new' } | { kind: 'settle' } | null

export default function App() {
  const [projectId, setProjectId] = useState<number | null>(null)
  const [threadId, setThreadId] = useState<number | null>(null)
  // 스레드별 문서 체크 상태 (null = 전체 선택) — 메모리 전용, 새로고침 시 리셋
  const [docSelection, setDocSelection] = useState<Record<number, number[] | null>>({})
  const [overlay, setOverlay] = useState<Overlay>(null)

  const isMobile = useIsMobile()
  const [mobileView, setMobileView] = useState<'home' | 'chat'>('home')
  const [sheetOpen, setSheetOpen] = useState(false)

  const docIds = threadId !== null ? (docSelection[threadId] ?? null) : null

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

  // 모바일 뒤로가기 제스처/버튼(popstate) → 목록 화면 + 시트 닫힘으로 복귀
  useEffect(() => {
    function onPop() {
      setMobileView('home')
      setSheetOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 모바일 챗 화면을 보고 있는 도중 threadId가 null이 되면(스레드 삭제 등) 목록으로 되돌린다
  useEffect(() => {
    if (isMobile && mobileView === 'chat' && threadId === null) {
      setMobileView('home')
    }
  }, [isMobile, mobileView, threadId])

  function selectProject(id: number | null) {
    if (id === projectId) return
    setProjectId(id)
    setThreadId(null)
  }

  function openThread(id: number | null) {
    setThreadId(id)
    if (isMobile && id !== null) {
      history.pushState({ view: 'chat' }, '')
      setMobileView('chat')
    }
  }

  function updateDocSelection(ids: number[] | null) {
    if (threadId !== null) setDocSelection((s) => ({ ...s, [threadId]: ids }))
  }

  // 오버레이는 데스크톱/모바일 두 모드에서 공통 렌더 — 분기마다 중복하지 않는다
  const overlays = (
    <>
      {overlay?.kind === 'doc' && projectId !== null && (
        <DocEditor projectId={projectId} docId={overlay.docId} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'settle' && projectId !== null && threadId !== null && (
        <SettleOverlay projectId={projectId} threadId={threadId} onClose={() => setOverlay(null)} />
      )}
    </>
  )

  // threadId가 null인데 mobileView가 아직 'chat'인 과도 상태(위 effect가 다음 렌더에 정리)도
  // home 취급해서 데스크톱 3판으로 잘못 새지 않게 한다.
  const showMobileChat = isMobile && mobileView === 'chat' && threadId !== null

  if (isMobile && !showMobileChat) {
    return (
      <div className="app mobile">
        <Sidebar
          selectedProjectId={projectId}
          selectedThreadId={threadId}
          onSelectProject={selectProject}
          onSelectThread={openThread}
        />
        {overlays}
      </div>
    )
  }

  if (showMobileChat) {
    return (
      <div className="app mobile">
        <main className="chat">
          <ChatPane
            key={threadId}
            threadId={threadId}
            docIds={docIds}
            onBack={() => history.back()}
            onOpenDocs={() => setSheetOpen(true)}
          />
        </main>
        {sheetOpen && projectId !== null && (
          <div className="sheet-backdrop" role="presentation">
            <button aria-label="시트 닫기" className="sheet-close" onClick={() => setSheetOpen(false)} />
            <div className="sheet">
              <DocsPanel
                projectId={projectId}
                threadId={threadId}
                docIds={docIds}
                onChangeDocIds={updateDocSelection}
                onOpenDoc={(docId) => setOverlay({ kind: 'doc', docId })}
                onSettle={() => setOverlay({ kind: 'settle' })}
              />
            </div>
          </div>
        )}
        {overlays}
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        selectedProjectId={projectId}
        selectedThreadId={threadId}
        onSelectProject={selectProject}
        onSelectThread={openThread}
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
          onChangeDocIds={updateDocSelection}
          onOpenDoc={(docId) => setOverlay({ kind: 'doc', docId })}
          onSettle={() => setOverlay({ kind: 'settle' })}
        />
      ) : (
        <aside className="docs-panel" />
      )}
      {overlays}
    </div>
  )
}
