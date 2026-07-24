import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw'
import { renderWithClient } from '../test/utils'
import { makeBudget, makeDocMeta, makeProject } from '../test/fixtures'
import { DocsPanel } from './DocsPanel'

const noop = () => {}

function projectHandler(docs = [makeDocMeta({ id: 1, kind: 'idea', title: '기획' }), makeDocMeta({ id: 2, kind: 'research', title: '조사' })]) {
  return http.get('/api/projects/1', () =>
    HttpResponse.json({ project: makeProject({ id: 1 }), docs, threads: [] }),
  )
}

function budgetCapture() {
  const calls: string[] = []
  const handler = http.get('/api/threads/7/budget', ({ request }) => {
    calls.push(new URL(request.url).search)
    return HttpResponse.json(makeBudget())
  })
  return { calls, handler }
}

test('전체 선택(docIds=null)이면 budget 요청에 doc_ids가 없다', async () => {
  const { calls, handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={null} onChangeDocIds={noop} onOpenDoc={noop} onSettle={noop} />,
  )
  expect(await screen.findByText('기획')).toBeInTheDocument()
  await waitFor(() => expect(calls).toEqual(['']))
  expect(screen.getByLabelText('기획 선택')).toBeChecked()
  expect(screen.getByLabelText('조사 선택')).toBeChecked()
  expect(screen.getByText('idea')).toBeInTheDocument() // kind 뱃지
})

test('전체 해제(docIds=[])면 ?doc_ids= 로 요청한다', async () => {
  const { calls, handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={[]} onChangeDocIds={noop} onOpenDoc={noop} onSettle={noop} />,
  )
  await waitFor(() => expect(calls).toEqual(['?doc_ids=']))
  expect(await screen.findByLabelText('기획 선택')).not.toBeChecked()
})

test('전체 선택 상태에서 하나 해제 → 남은 id 배열', async () => {
  const onChange = vi.fn()
  const { handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={null} onChangeDocIds={onChange} onOpenDoc={noop} onSettle={noop} />,
  )
  await userEvent.click(await screen.findByLabelText('조사 선택'))
  expect(onChange).toHaveBeenCalledWith([1])
})

test('부분 선택에서 나머지 체크 → null로 정규화', async () => {
  const onChange = vi.fn()
  const { handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={[1]} onChangeDocIds={onChange} onOpenDoc={noop} onSettle={noop} />,
  )
  await userEvent.click(await screen.findByLabelText('조사 선택'))
  expect(onChange).toHaveBeenCalledWith(null)
})

test('문서 제목 클릭 → onOpenDoc(id), 새 문서 → onOpenDoc("new"), 정착 → onSettle', async () => {
  const onOpenDoc = vi.fn()
  const onSettle = vi.fn()
  const { handler } = budgetCapture()
  server.use(projectHandler(), handler)
  renderWithClient(
    <DocsPanel projectId={1} threadId={7} docIds={null} onChangeDocIds={noop} onOpenDoc={onOpenDoc} onSettle={onSettle} />,
  )
  await userEvent.click(await screen.findByText('기획'))
  expect(onOpenDoc).toHaveBeenCalledWith(1)
  await userEvent.click(screen.getByLabelText('새 문서'))
  expect(onOpenDoc).toHaveBeenCalledWith('new')
  await userEvent.click(screen.getByRole('button', { name: '정착' }))
  expect(onSettle).toHaveBeenCalled()
})

test('threadId가 null이면 게이지 자리표시 + 정착 비활성 (budget 요청 없음)', async () => {
  server.use(projectHandler())
  renderWithClient(
    <DocsPanel projectId={1} threadId={null} docIds={null} onChangeDocIds={noop} onOpenDoc={noop} onSettle={noop} />,
  )
  expect(await screen.findByText('스레드를 선택하면 예산이 표시됩니다')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '정착' })).toBeDisabled()
})
