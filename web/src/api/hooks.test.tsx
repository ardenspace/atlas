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
