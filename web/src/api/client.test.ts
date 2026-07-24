import { http, HttpResponse } from 'msw'
import { server } from '../test/msw'
import { ApiError, api } from './client'

test('JSON 응답을 그대로 반환한다', async () => {
  server.use(http.get('/api/health', () => HttpResponse.json({ ok: true, gemma: false })))
  await expect(api('/api/health')).resolves.toEqual({ ok: true, gemma: false })
})

test('204는 undefined를 반환한다', async () => {
  server.use(http.delete('/api/docs/1', () => new HttpResponse(null, { status: 204 })))
  await expect(api('/api/docs/1', { method: 'DELETE' })).resolves.toBeUndefined()
})

test('에러 응답은 detail을 담은 ApiError로 던진다', async () => {
  server.use(
    http.get('/api/projects/9', () =>
      HttpResponse.json({ detail: 'project not found' }, { status: 404 }),
    ),
  )
  const err: unknown = await api('/api/projects/9').catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).status).toBe(404)
  expect((err as ApiError).detail).toBe('project not found')
})

test('JSON 아닌 에러 본문은 statusText로 대체한다', async () => {
  server.use(
    http.get('/api/broken', () =>
      new HttpResponse('boom', { status: 500, statusText: 'Internal Server Error' }),
    ),
  )
  const err = (await api('/api/broken').catch((e: unknown) => e)) as ApiError
  expect(err.detail).toBe('Internal Server Error')
})
