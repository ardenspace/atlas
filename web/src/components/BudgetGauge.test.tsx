import { render, screen } from '@testing-library/react'
import { makeBudget } from '../test/fixtures'
import { BudgetGauge } from './BudgetGauge'

test('로딩 중 표시', () => {
  render(<BudgetGauge budget={undefined} isLoading={true} />)
  expect(screen.getByText('예산 계산 중…')).toBeInTheDocument()
})

test('정상: total/usable와 퍼센트', () => {
  render(<BudgetGauge budget={makeBudget({ total: 3584, limit: 8192, reserve: 1024 })} isLoading={false} />)
  expect(screen.getByText('3584 / 7168 tok (50%)')).toBeInTheDocument()
})

test('추정치면 표기가 붙는다', () => {
  render(<BudgetGauge budget={makeBudget({ total: 3584, exact: false })} isLoading={false} />)
  expect(screen.getByText(/· 추정/)).toBeInTheDocument()
})

test('85% 이상이면 warn 클래스', () => {
  const { container } = render(
    <BudgetGauge budget={makeBudget({ total: 6900, limit: 8192, reserve: 1024 })} isLoading={false} />,
  )
  expect(container.querySelector('.gauge')).toHaveClass('warn') // 6900/7168 = 96%
})

test('limit이 null이면 절대값 + 한도 미확인', () => {
  render(<BudgetGauge budget={makeBudget({ limit: null, total: 1234, exact: false })} isLoading={false} />)
  expect(screen.getByText(/~1234 tok \(한도 미확인/)).toBeInTheDocument()
})
