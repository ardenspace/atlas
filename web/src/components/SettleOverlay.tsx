import { useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useCreateDoc, useProject, useUpdateDoc } from '../api/hooks'
import { streamSSE } from '../api/sse'
import type { DocKind } from '../api/types'
import { Markdown } from './Markdown'

const KINDS: DocKind[] = ['idea', 'research', 'world', 'note']

interface SettleOverlayProps {
  projectId: number
  threadId: number
  onClose: () => void
}

type Phase =
  | { step: 'pick' }
  | { step: 'streaming'; draft: string; error: string | null }
  | { step: 'edit'; targetDocId: number | null; kind: DocKind; title: string; content: string }

export function SettleOverlay({ projectId, threadId, onClose }: SettleOverlayProps) {
  const { data } = useProject(projectId)
  const createDoc = useCreateDoc()
  const updateDoc = useUpdateDoc()
  const [target, setTarget] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>({ step: 'pick' })
  const abortRef = useRef<AbortController | null>(null)
  const abortedRef = useRef(false)

  const docs = data?.docs ?? []

  async function generate() {
    let draft = ''
    let error: string | null = null
    abortedRef.current = false
    setPhase({ step: 'streaming', draft: '', error: null })
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await streamSSE(
        `/api/threads/${threadId}/settle`,
        target === null ? {} : { target_doc_id: target },
        {
          onDelta: (t) => {
            draft += t
            setPhase({ step: 'streaming', draft, error: null })
          },
          onError: (m) => {
            error = m
          },
        },
        ac.signal,
      )
    } catch (e) {
      error = e instanceof ApiError ? e.detail : '요청에 실패했어요. 서버가 떠 있는지 확인하세요.'
    }
    abortRef.current = null
    if (abortedRef.current) {
      setPhase({ step: 'pick' })
      return
    }
    if (error !== null) {
      setPhase({ step: 'streaming', draft, error })
      return
    }
    const targetMeta = target !== null ? docs.find((d) => d.id === target) : undefined
    setPhase({
      step: 'edit',
      targetDocId: target,
      kind: targetMeta?.kind ?? 'world',
      title: targetMeta?.title ?? '정착 초안',
      content: draft,
    })
  }

  function stop() {
    abortedRef.current = true
    abortRef.current?.abort()
  }

  // 실패 시 편집 화면을 열어둔 채 서버 detail을 그대로 표시 (성공 시에만 onClose) — DocEditor와 동일 패턴
  const saveError = createDoc.error ?? updateDoc.error
  const saving = createDoc.isPending || updateDoc.isPending

  function save(p: Extract<Phase, { step: 'edit' }>) {
    if (!p.title.trim()) return
    if (p.targetDocId === null) {
      createDoc.mutate(
        { projectId, doc: { kind: p.kind, title: p.title, content: p.content } },
        { onSuccess: onClose },
      )
    } else {
      updateDoc.mutate(
        { id: p.targetDocId, projectId, patch: { kind: p.kind, title: p.title, content: p.content } },
        { onSuccess: onClose },
      )
    }
  }

  function discard() {
    if (window.confirm('초안을 버릴까요? 저장되지 않습니다.')) onClose()
  }

  return (
    <div className="overlay" role="dialog" aria-label="정착">
      <div className="overlay-box">
        {phase.step === 'pick' && (
          <>
            <h3>대화를 어디에 정착할까요?</h3>
            <div className="settle-pick overlay-body">
              <label>
                <input
                  type="radio"
                  name="settle-target"
                  aria-label="새 문서로"
                  checked={target === null}
                  onChange={() => setTarget(null)}
                />
                새 문서로
              </label>
              {docs.map((d) => (
                <label key={d.id}>
                  <input
                    type="radio"
                    name="settle-target"
                    aria-label={d.title}
                    checked={target === d.id}
                    onChange={() => setTarget(d.id)}
                  />
                  <span className={`kind kind-${d.kind}`}>{d.kind}</span> {d.title}
                </label>
              ))}
            </div>
            <div className="overlay-foot">
              <button type="button" onClick={onClose}>닫기</button>
              <button type="button" className="primary" onClick={() => void generate()}>
                초안 생성
              </button>
            </div>
          </>
        )}
        {phase.step === 'streaming' && (
          <>
            <h3>초안 생성 중…</h3>
            <div className="overlay-body">
              <Markdown text={phase.draft} />
              {phase.error !== null && <p className="settle-error">{phase.error}</p>}
            </div>
            <div className="overlay-foot">
              {phase.error === null ? (
                <button type="button" onClick={stop}>중단</button>
              ) : (
                <button type="button" onClick={() => setPhase({ step: 'pick' })}>뒤로</button>
              )}
            </div>
          </>
        )}
        {phase.step === 'edit' && (
          <>
            <div className="overlay-head">
              <input
                aria-label="제목"
                value={phase.title}
                onChange={(e) => setPhase({ ...phase, title: e.target.value })}
              />
              <select
                aria-label="종류"
                value={phase.kind}
                onChange={(e) => setPhase({ ...phase, kind: e.target.value as DocKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <textarea
              aria-label="본문"
              className="overlay-body"
              value={phase.content}
              onChange={(e) => setPhase({ ...phase, content: e.target.value })}
            />
            {saveError !== null && (
              <p className="settle-error">
                {saveError instanceof ApiError
                  ? saveError.detail
                  : '요청에 실패했어요. 서버가 떠 있는지 확인하세요.'}
              </p>
            )}
            <div className="overlay-foot">
              <button type="button" className="danger" onClick={discard}>버리기</button>
              <button
                type="button"
                className="primary"
                onClick={() => save(phase)}
                disabled={!phase.title.trim() || saving}
              >
                저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
