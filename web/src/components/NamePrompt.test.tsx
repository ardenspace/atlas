import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NamePrompt } from './NamePrompt'

test('입력 후 확인 → 공백을 trim해서 onSubmit', async () => {
  const onSubmit = vi.fn()
  render(<NamePrompt label="프로젝트 이름" onSubmit={onSubmit} onCancel={() => {}} />)
  await userEvent.type(screen.getByRole('textbox', { name: '프로젝트 이름' }), '  새 프로젝트  ')
  await userEvent.click(screen.getByRole('button', { name: '확인' }))
  expect(onSubmit).toHaveBeenCalledWith('새 프로젝트')
})

test('기존 이름이 채워지고 전체 선택된 상태로 열린다', () => {
  render(<NamePrompt label="스레드 제목" initial="옛 제목" onSubmit={() => {}} onCancel={() => {}} />)
  const input = screen.getByRole('textbox', { name: '스레드 제목' }) as HTMLInputElement
  expect(input.value).toBe('옛 제목')
  expect(input).toHaveFocus()
})

// 회귀 테스트: window.prompt는 IME 조합 중 Enter를 누르면 조합 중인 글자를 버린 채
// 값을 돌려줬다 ("강별" → "강"). 끝에 공백을 쳐야 조합이 확정돼 온전히 저장됐다.
test('한글 조합 중 Enter는 제출하지 않고, 조합이 끝나면 마지막 글자까지 제출한다', () => {
  const onSubmit = vi.fn()
  render(<NamePrompt label="스레드 제목" onSubmit={onSubmit} onCancel={() => {}} />)
  const input = screen.getByRole('textbox', { name: '스레드 제목' })

  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '강별_스레드3' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(onSubmit).not.toHaveBeenCalled()

  fireEvent.compositionEnd(input)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onSubmit).toHaveBeenCalledWith('강별_스레드3')
})

test('빈 값이면 제출하지 않는다', async () => {
  const onSubmit = vi.fn()
  render(<NamePrompt label="프로젝트 이름" onSubmit={onSubmit} onCancel={() => {}} />)
  await userEvent.type(screen.getByRole('textbox', { name: '프로젝트 이름' }), '   ')
  await userEvent.click(screen.getByRole('button', { name: '확인' }))
  expect(onSubmit).not.toHaveBeenCalled()
})

test('Escape·취소는 onCancel', async () => {
  const onCancel = vi.fn()
  render(<NamePrompt label="프로젝트 이름" onSubmit={() => {}} onCancel={onCancel} />)
  fireEvent.keyDown(screen.getByRole('textbox', { name: '프로젝트 이름' }), { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(onCancel).toHaveBeenCalledTimes(2)
})
