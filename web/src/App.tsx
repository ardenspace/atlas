import { useEffect, useState } from 'react'
import { useProject, useProjects } from './api/hooks'
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

  function selectProject(id: number | null) {
    if (id === projectId) return
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
