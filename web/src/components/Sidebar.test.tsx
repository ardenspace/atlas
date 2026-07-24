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
