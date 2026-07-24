import { render, screen } from '@testing-library/react'
import App from './App'

test('앱 셸이 렌더된다', () => {
  render(<App />)
  expect(screen.getByText('atlas 로딩됨')).toBeInTheDocument()
})
