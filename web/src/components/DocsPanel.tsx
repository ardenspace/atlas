import { useBudget, useProject } from '../api/hooks'
import { BudgetGauge } from './BudgetGauge'

interface DocsPanelProps {
  projectId: number
  threadId: number | null
  docIds: number[] | null
  onChangeDocIds: (ids: number[] | null) => void
  onOpenDoc: (id: number | 'new') => void
  onSettle: () => void
}

export function DocsPanel({
  projectId, threadId, docIds, onChangeDocIds, onOpenDoc, onSettle,
}: DocsPanelProps) {
  const { data } = useProject(projectId)
  const budget = useBudget(threadId, docIds)
  const docs = data?.docs ?? []

  function toggle(docId: number) {
    const all = docs.map((d) => d.id)
    const current = docIds === null ? all : docIds
    const next = current.includes(docId)
      ? current.filter((i) => i !== docId)
      : [...current, docId]
    const isAll = next.length === all.length && all.every((i) => next.includes(i))
    onChangeDocIds(isAll ? null : next)
  }

  return (
    <aside className="docs-panel">
      <div className="section-head">
        <h2>문서</h2>
        <button aria-label="새 문서" onClick={() => onOpenDoc('new')}>+</button>
      </div>
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d.id}>
            <input
              type="checkbox"
              aria-label={`${d.title} 선택`}
              checked={docIds === null || docIds.includes(d.id)}
              onChange={() => toggle(d.id)}
            />
            <span className={`kind kind-${d.kind}`}>{d.kind}</span>
            <button className="doc-title" onClick={() => onOpenDoc(d.id)}>{d.title}</button>
          </li>
        ))}
        {docs.length === 0 && <li className="dim">문서 없음</li>}
      </ul>
      <div className="docs-footer">
        {threadId !== null ? (
          <BudgetGauge budget={budget.data} isLoading={budget.isLoading} />
        ) : (
          <div className="gauge">
            <span className="dim">스레드를 선택하면 예산이 표시됩니다</span>
          </div>
        )}
        <button className="settle" onClick={onSettle} disabled={threadId === null}>정착</button>
      </div>
    </aside>
  )
}
