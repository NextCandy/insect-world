import { describe, expect, it } from 'vitest'
import { onRequestGet } from '../../../functions/index'

describe('根路径语言响应缓存', () => {
  it.each([['', 302], ['iw-locale=zh', 200]] as const)('cookie %s → %s，并禁止共享缓存', async (cookie, status) => {
    const response = await onRequestGet({
      request: new Request('https://insect-world.test/', {
        headers: { 'Accept-Language': 'en', Cookie: cookie },
      }),
      next: async () => new Response('中文首页', { headers: { Vary: 'Accept-Encoding', 'Cache-Control': 'public' } }),
    })
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const vary = response.headers.get('Vary')!.toLowerCase().split(/,\s*/)
    expect(vary).toEqual(expect.arrayContaining(['accept-language', 'cookie', 'user-agent']))
    if (status === 200) expect(vary).toContain('accept-encoding')
  })
})
