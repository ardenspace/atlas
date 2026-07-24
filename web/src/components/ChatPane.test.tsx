import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server, sseResponse } from '../test/msw'
import { renderWithClient } from '../test/utils'
import { makeMessage, makeThread } from '../test/fixtures'
import { ChatPane } from './ChatPane'

function threadHandler(messagesPerCall: Array<ReturnType<typeof makeMessage>[]>) {
  let call = 0
  return http.get('/api/threads/1', () => {
    const messages = messagesPerCall[Math.min(call, messagesPerCall.length - 1)]
    call += 1
    return HttpResponse.json({ thread: makeThread({ id: 1 }), messages })
  })
}

test('메시지를 렌더하고 assistant는 마크다운으로 그린다', async () => {
  server.use(
    threadHandler([
      [makeMessage({ id: 1, role: 'user', content: '안녕' }),
       makeMessage({ id: 2, role: 'assistant', content: '**굵게** 답함' })],
    ]),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  expect(await screen.findByText('안녕')).toBeInTheDocument()
  const bold = await screen.findByText('굵게')
  expect(bold.tagName).toBe('STRONG')
})

test('전송 → delta 누적 → 완료 후 재조회본 표시, docIds=null이면 doc_ids 생략', async () => {
  let chatBody: unknown = null
  server.use(
    threadHandler([
      [],
      [makeMessage({ id: 1, role: 'user', content: '용 얘기 하자' }),
       makeMessage({ id: 2, role: 'assistant', content: '좋아, 용부터 정하자' })],
    ]),
    http.post('/api/threads/1/chat', async ({ request }) => {
      chatBody = await request.json()
      return sseResponse([{ delta: '좋아, ' }, { delta: '용부터 정하자' }, '[DONE]'])
    }),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '용 얘기 하자')
  await userEvent.click(screen.getByRole('button', { name: '전송' }))
  expect(await screen.findByText('좋아, 용부터 정하자')).toBeInTheDocument()
  expect(chatBody).toEqual({ message: '용 얘기 하자' }) // doc_ids 없음
  expect(screen.getByLabelText('메시지 입력')).toHaveValue('')
})

test('docIds가 목록이면 doc_ids로 보낸다', async () => {
  let chatBody: unknown = null
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', async ({ request }) => {
      chatBody = await request.json()
      return sseResponse(['[DONE]'])
    }),
  )
  renderWithClient(<ChatPane threadId={1} docIds={[2, 5]} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '가자')
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(chatBody).toEqual({ message: '가자', doc_ids: [2, 5] }))
})

test('SSE error 이벤트는 인라인 에러로 표시한다', async () => {
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', () =>
      sseResponse([{ delta: '부분 답' }, { error: 'llama-server(:8080)에 연결할 수 없어요.' }, '[DONE]']),
    ),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '있니')
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByText(/연결할 수 없어요/)).toBeInTheDocument()
})

test('413이면 detail을 보여주고 입력을 복원한다', async () => {
  const detail = '컨텍스트 초과 예상 (9000/8192 토큰). 문서 선택을 줄이거나 새 스레드에서 계속하세요.'
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', () => HttpResponse.json({ detail }, { status: 413 })),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '긴 얘기')
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByText(detail)).toBeInTheDocument()
  expect(screen.getByLabelText('메시지 입력')).toHaveValue('긴 얘기')
})

test('스트리밍 중 [중단]을 누르면 초기 상태로 돌아온다', async () => {
  server.use(
    threadHandler([[]]),
    http.post('/api/threads/1/chat', () => {
      const enc = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode('data: {"delta": "끝나지 않는"}\n\n'))
        },
      })
      return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }),
  )
  renderWithClient(<ChatPane threadId={1} docIds={null} />)
  await userEvent.type(screen.getByLabelText('메시지 입력'), '멈춰볼게')
  await userEvent.keyboard('{Enter}')
  await userEvent.click(await screen.findByRole('button', { name: '중단' }))
  expect(await screen.findByRole('button', { name: '전송' })).toBeInTheDocument()
  expect(screen.getByLabelText('메시지 입력')).not.toBeDisabled()
})
