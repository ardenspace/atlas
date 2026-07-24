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
  const { unmount } = renderWithClient(<DocEditor projectId={1} docId={5} onClose={onClose} />)
  await userEvent.click(await screen.findByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deleted).toBe(true))
  expect(onClose).toHaveBeenCalled()

  onClose.mockClear()
  unmount() // onClose는 목이라 첫 오버레이가 자동으로 사라지지 않는다 — 새 문서 케이스 전에 정리
  renderWithClient(<DocEditor projectId={1} docId="new" onClose={onClose} />)
  expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
})
