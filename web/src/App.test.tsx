import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from './test/msw'
import { renderWithClient } from './test/utils'
import { makeBudget, makeDoc, makeDocMeta, makeMessage, makeProject, makeThread, makeThreadMeta } from './test/fixtures'
import App from './App'

function baseHandlers() {
  return [
    http.get('/api/health', () => HttpResponse.json({ ok: true, gemma: true })),
    http.get('/api/projects', () => HttpResponse.json([makeProject({ id: 1, name: '아틀라스' })])),
    http.get('/api/projects/1', () =>
      HttpResponse.json({
        project: makeProject({ id: 1, name: '아틀라스' }),
        docs: [makeDocMeta({ id: 2, kind: 'world', title: '세계관 문서' })],
        threads: [makeThreadMeta({ id: 7, title: '용 대화' })],
      }),
    ),
    http.get('/api/threads/7', () =>
      HttpResponse.json({
        thread: makeThread({ id: 7, title: '용 대화' }),
        messages: [makeMessage({ id: 1, role: 'user', content: '용 얘기' })],
      }),
    ),
    http.get('/api/threads/7/budget', () => HttpResponse.json(makeBudget())),
    http.get('/api/docs/2', () => HttpResponse.json(makeDoc({ id: 2, kind: 'world', title: '세계관 문서', content: '# 대륙' }))),
  ]
}

test('프로젝트 → 스레드 → 챗+문서패널, 문서 클릭 → 편집 오버레이', async () => {
  server.use(...baseHandlers())
  renderWithClient(<App />)
  expect(screen.getByText('프로젝트를 선택하거나 만들어서 시작하세요.')).toBeInTheDocument()

  await userEvent.click(await screen.findByText('아틀라스'))
  expect(await screen.findByText('스레드를 선택하거나 만들어서 시작하세요.')).toBeInTheDocument()
  expect(await screen.findByText('세계관 문서')).toBeInTheDocument() // 문서 패널

  await userEvent.click(screen.getByText('용 대화'))
  expect(await screen.findByLabelText('메시지 입력')).toBeInTheDocument()
  expect(await screen.findByText('용 얘기')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText(/tok \(/)).toBeInTheDocument()) // 예산 게이지

  await userEvent.click(screen.getByText('세계관 문서'))
  expect(await screen.findByRole('dialog', { name: '문서 편집' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '닫기' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '문서 편집' })).not.toBeInTheDocument(),
  )
})

test('정착 버튼 → 정착 오버레이', async () => {
  server.use(...baseHandlers())
  renderWithClient(<App />)
  await userEvent.click(await screen.findByText('아틀라스'))
  await userEvent.click(await screen.findByText('용 대화'))
  await userEvent.click(await screen.findByRole('button', { name: '정착' }))
  expect(await screen.findByRole('dialog', { name: '정착' })).toBeInTheDocument()
})

test('프로젝트를 바꾸면 스레드 선택이 풀린다', async () => {
  // MSW는 같은 use() 배열 안에서 앞선 핸들러가 이기므로, 오버라이드를 baseHandlers보다 먼저 둔다
  server.use(
    http.get('/api/projects', () =>
      HttpResponse.json([makeProject({ id: 1, name: '아틀라스' }), makeProject({ id: 3, name: '차크', slug: 'c' })]),
    ),
    http.get('/api/projects/3', () =>
      HttpResponse.json({ project: makeProject({ id: 3, name: '차크', slug: 'c' }), docs: [], threads: [] }),
    ),
    ...baseHandlers(),
  )
  renderWithClient(<App />)
  await userEvent.click(await screen.findByText('아틀라스'))
  await userEvent.click(await screen.findByText('용 대화'))
  await screen.findByLabelText('메시지 입력')
  await userEvent.click(screen.getByText('차크'))
  expect(await screen.findByText('스레드를 선택하거나 만들어서 시작하세요.')).toBeInTheDocument()
})
