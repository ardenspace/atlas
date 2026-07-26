import { useState } from 'react'
import {
  useCreateProject, useCreateThread, useDeleteProject, useDeleteThread,
  useHealth, useProject, useProjects, useUpdateProject, useUpdateThread,
} from '../api/hooks'
import type { Project, ThreadMeta } from '../api/types'
import { NamePrompt } from './NamePrompt'

type Prompt =
  | { kind: 'new-project' }
  | { kind: 'rename-project'; project: Project }
  | { kind: 'new-thread' }
  | { kind: 'rename-thread'; thread: ThreadMeta }

function promptLabel(p: Prompt) {
  return p.kind === 'new-project' || p.kind === 'rename-project' ? '프로젝트 이름' : '스레드 제목'
}

function promptInitial(p: Prompt) {
  if (p.kind === 'rename-project') return p.project.name
  if (p.kind === 'rename-thread') return p.thread.title
  return ''
}

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
  const [prompt, setPrompt] = useState<Prompt | null>(null)

  function submitPrompt(value: string) {
    if (prompt === null) return
    setPrompt(null)
    switch (prompt.kind) {
      case 'new-project':
        createProject.mutate({ name: value })
        break
      case 'rename-project':
        if (value !== prompt.project.name) {
          updateProject.mutate({ id: prompt.project.id, patch: { name: value } })
        }
        break
      case 'new-thread':
        if (selectedProjectId === null) return
        createThread.mutate(
          { projectId: selectedProjectId, title: value },
          { onSuccess: (t) => onSelectThread(t.id) },
        )
        break
      case 'rename-thread':
        if (selectedProjectId === null) return
        if (value !== prompt.thread.title) {
          updateThread.mutate({
            id: prompt.thread.id,
            projectId: selectedProjectId,
            patch: { title: value },
          })
        }
        break
    }
  }

  function removeProject(p: Project) {
    if (!window.confirm(`"${p.name}" 프로젝트를 삭제할까요? 문서·스레드도 함께 지워집니다.`)) return
    deleteProject.mutate(p.id, {
      onSuccess: () => {
        if (selectedProjectId === p.id) onSelectProject(null)
      },
    })
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
          <button aria-label="새 프로젝트" onClick={() => setPrompt({ kind: 'new-project' })}>+</button>
        </div>
        <ul>
          {(projects.data ?? []).map((p) => (
            <li key={p.id} className={p.id === selectedProjectId ? 'active' : ''}>
              <button className="row-main" onClick={() => onSelectProject(p.id)}>{p.name}</button>
              <span className="row-actions">
                <button
                  aria-label="프로젝트 이름 변경"
                  onClick={() => setPrompt({ kind: 'rename-project', project: p })}
                >
                  ✎
                </button>
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
            <button aria-label="새 스레드" onClick={() => setPrompt({ kind: 'new-thread' })}>+</button>
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
                  <button
                    aria-label="스레드 이름 변경"
                    onClick={() => setPrompt({ kind: 'rename-thread', thread: t })}
                  >
                    ✎
                  </button>
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
      {prompt !== null && (
        <NamePrompt
          label={promptLabel(prompt)}
          initial={promptInitial(prompt)}
          onSubmit={submitPrompt}
          onCancel={() => setPrompt(null)}
        />
      )}
    </aside>
  )
}
