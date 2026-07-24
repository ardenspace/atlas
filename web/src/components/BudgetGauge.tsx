import type { Budget } from '../api/types'

interface BudgetGaugeProps {
  budget: Budget | undefined
  isLoading: boolean
}

export function BudgetGauge({ budget, isLoading }: BudgetGaugeProps) {
  if (isLoading || !budget) {
    return (
      <div className="gauge">
        <span className="dim">예산 계산 중…</span>
      </div>
    )
  }
  const approx = budget.exact ? '' : ' · 추정'
  if (budget.limit === null) {
    return (
      <div className="gauge">
        <span className="dim">~{budget.total} tok (한도 미확인{approx})</span>
      </div>
    )
  }
  const usable = budget.limit - budget.reserve
  const pct = Math.min(100, Math.round((budget.total / usable) * 100))
  return (
    <div className={pct >= 85 ? 'gauge warn' : 'gauge'}>
      <div className="gauge-bar">
        <div className="gauge-fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{`${budget.total} / ${usable} tok (${pct}%)${approx}`}</span>
    </div>
  )
}
