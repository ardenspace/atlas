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

test('저장 실패 시 서버 detail을 그대로 보여주고 편집 화면에 남는다', async () => {
  const onClose = vi.fn()
  const detail = '저장에 실패했어요.'
  server.use(
    projectHandler(),
    http.post('/api/threads/7/settle', () => sseResponse([{ delta: '초안 본문' }, '[DONE]'])),
    http.post('/api/projects/1/docs', () => HttpResponse.json({ detail }, { status: 500 })),
  )
  renderWithClient(<SettleOverlay projectId={1} threadId={7} onClose={onClose} />)
  await userEvent.click(await screen.findByRole('button', { name: '초안 생성' }))
  await screen.findByLabelText('본문')
  await userEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText(detail)).toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('본문')).toHaveValue('초안 본문') // 초안 보존
})
