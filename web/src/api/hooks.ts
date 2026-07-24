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
