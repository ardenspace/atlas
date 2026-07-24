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
