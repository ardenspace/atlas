import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { useThread } from '../api/hooks'
import { streamSSE } from '../api/sse'
import { Markdown } from './Markdown'

interface ChatPaneProps {
  threadId: number
  docIds: number[] | null
}

export function ChatPane({ threadId, docIds }: ChatPaneProps) {
  const qc = useQueryClient()
  const { data } = useThread(threadId)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<{ user: string; draft: string } | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const messages = data?.messages ?? []

  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight })
  }, [messages.length, streaming?.draft])

  async function send() {
    const message = input.trim()
    if (!message || streaming) return
    setInput('')
    setChatError(null)
    setStreaming({ user: message, draft: '' })
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await streamSSE(
        `/api/threads/${threadId}/chat`,
        docIds === null ? { message } : { message, doc_ids: docIds },
        {
          onDelta: (t) => setStreaming((s) => (s ? { ...s, draft: s.draft + t } : s)),
          onError: (m) => setChatError(m),
        },
        ac.signal,
      )
    } catch (e) {
      // HTTP 에러(413 등)는 스트림 시작 전 — 서버가 user 메시지를 저장하지 않았으므로 입력 복원
      setChatError(e instanceof ApiError ? e.detail : '요청에 실패했어요. 서버가 떠 있는지 확인하세요.')
      setInput(message)
    } finally {
      abortRef.current = null
      await qc.invalidateQueries({ queryKey: ['thread', threadId] })
      await qc.invalidateQueries({ queryKey: ['budget', threadId] })
      setStreaming(null)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <>
      <header className="chat-head">
        <h2>{data?.thread.title ?? ''}</h2>
      </header>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !streaming && !chatError && (
          <p className="placeholder">첫 메시지를 보내보세요.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
          </div>
        ))}
        {streaming && (
          <>
            <div className="msg user">{streaming.user}</div>
            <div className="msg assistant streaming">
              <Markdown text={streaming.draft} />
            </div>
          </>
        )}
        {chatError && <div className="msg error">{chatError}</div>}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          aria-label="메시지 입력"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="세계관 얘기해보자… (Enter 전송, Shift+Enter 줄바꿈)"
          disabled={streaming !== null}
        />
        {streaming ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>중단</button>
        ) : (
          <button type="submit" disabled={!input.trim()}>전송</button>
        )}
      </form>
    </>
  )
}
