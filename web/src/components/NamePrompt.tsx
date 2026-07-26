import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'

interface NamePromptProps {
  label: string
  initial?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * 이름·제목 한 줄 입력. window.prompt를 대체한다.
 *
 * 네이티브 prompt는 IME 조합이 확정되기 전에 Enter를 받으면 조합 중인 글자를 버린
 * 값을 돌려줘서, 한글 이름의 끝이 잘렸다 ("강별" → "강"). 여기서는 입력을
 * 비제어로 두고 제출 시점에 DOM 값을 그대로 읽으며, 조합 중 Enter는 무시한다.
 */
export function NamePrompt({ label, initial = '', onSubmit, onCancel }: NamePromptProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const headingId = useId()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function submit() {
    const value = inputRef.current?.value.trim() ?? ''
    if (value) onSubmit(value)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      onCancel()
      return
    }
    // 조합 중 Enter는 IME 확정용이다. 제출로 삼으면 마지막 글자를 잃는다.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
  }

  return (
    <div className="overlay" role="dialog" aria-labelledby={headingId}>
      <div className="overlay-box name-prompt">
        <h3 id={headingId}>{label}</h3>
        <input
          ref={inputRef}
          type="text"
          aria-label={label}
          defaultValue={initial}
          onKeyDown={onKeyDown}
        />
        <div className="overlay-foot">
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="primary" onClick={submit}>확인</button>
        </div>
      </div>
    </div>
  )
}
