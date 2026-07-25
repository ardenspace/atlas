import { renderHook } from '@testing-library/react'
import { useIsMobile } from './useIsMobile'

test('데스크톱(기본)에서는 false', () => {
  const { result } = renderHook(() => useIsMobile())
  expect(result.current).toBe(false)
})

test('모바일 플래그가 켜져 있으면 true', () => {
  ;(globalThis as any).__vpMobile = true
  const { result } = renderHook(() => useIsMobile())
  expect(result.current).toBe(true)
})
