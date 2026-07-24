import { useState } from 'react'
import { ApiError } from '../api/client'
import { useCreateDoc, useDeleteDoc, useDoc, useUpdateDoc } from '../api/hooks'
import type { Doc, DocKind } from '../api/types'
import { Markdown } from './Markdown'

const KINDS: DocKind[] = ['idea', 'research', 'world', 'note']

interface DocEditorProps {
  projectId: number
  docId: number | 'new'
  onClose: () => void
}

export function DocEditor({ projectId, docId, onClose }: DocEditorProps) {
  const isNew = docId === 'new'
  const { data } = useDoc(isNew ? null : docId)
  if (!isNew && !data) return null // 로딩 완료 후 폼을 초기화하기 위해 그 전엔 그리지 않는다
  return <DocEditorForm projectId={projectId} doc={isNew ? null : data!} onClose={onClose} />
}

function DocEditorForm({
  projectId, doc, onClose,
}: {
  projectId: number
  doc: Doc | null
  onClose: () => void
}) {
  const [kind, setKind] = useState<DocKind>(doc?.kind ?? 'note')
  const [title, setTitle] = useState(doc?.title ?? '')
  const [content, setContent] = useState(doc?.content ?? '')
  const [preview, setPreview] = useState(false)
  const createDoc = useCreateDoc()
  const updateDoc = useUpdateDoc()
  const deleteDoc = useDeleteDoc()

  // 실패 시 다이얼로그를 열어둔 채 서버 detail을 그대로 표시 (성공 시에만 onClose)
  const mutationError = createDoc.error ?? updateDoc.error ?? deleteDoc.error
  const saving = createDoc.isPending || updateDoc.isPending

  function save() {
    if (!title.trim()) return
    if (doc === null) {
      createDoc.mutate({ projectId, doc: { kind, title, content } }, { onSuccess: onClose })
    } else {
      updateDoc.mutate(
        { id: doc.id, projectId, patch: { kind, title, content } },
        { onSuccess: onClose },
      )
    }
  }

  function remove() {
    if (doc === null) return
    if (!window.confirm(`"${doc.title}" 문서를 삭제할까요?`)) return
    deleteDoc.mutate({ id: doc.id, projectId }, { onSuccess: onClose })
  }

  return (
    <div className="overlay" role="dialog" aria-label="문서 편집">
      <div className="overlay-box">
        <div className="overlay-head">
          <input
            aria-label="제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목"
          />
          <select aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button type="button" onClick={() => setPreview((p) => !p)}>
            {preview ? '편집' : '미리보기'}
          </button>
        </div>
        {preview ? (
          <div className="overlay-body">
            <Markdown text={content} />
          </div>
        ) : (
          <textarea
            aria-label="본문"
            className="overlay-body"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}
        {mutationError !== null && (
          <p className="settle-error">
            {mutationError instanceof ApiError
              ? mutationError.detail
              : '요청에 실패했어요. 서버가 떠 있는지 확인하세요.'}
          </p>
        )}
        <div className="overlay-foot">
          {doc !== null && (
            <button type="button" className="danger" onClick={remove}>삭제</button>
          )}
          <button type="button" onClick={onClose}>닫기</button>
          <button type="button" className="primary" onClick={save} disabled={!title.trim() || saving}>
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
