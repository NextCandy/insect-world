import { describe, expect, it, vi } from 'vitest'
import { readJson } from '../edge'

const req = (body: string, headers: Record<string, string> = {}) => new Request('https://example.test/api/feedback', { method: 'POST', body, headers })

describe('有大小限制的 JSON 读取', () => {
  it('按 UTF-8 字节计量：刚好 8 KiB 接受，多一字节拒绝', async () => {
    const body = JSON.stringify({ text: 'x'.repeat(8181) })
    expect(new TextEncoder().encode(body).length).toBe(8192)
    expect(await readJson(req(body))).toEqual({ ok: true, value: JSON.parse(body) })
    expect(await readJson(req(body + ' '))).toEqual({ ok: false, reason: 'too-large' })
  })

  it('中文按多字节计算，Content-Length 缺失或被低报也不能绕过上限', async () => {
    const body = JSON.stringify({ text: '虫'.repeat(3000) })
    for (const headers of [{} as Record<string, string>, { 'Content-Length': '1' }]) {
      expect(await readJson(req(body, headers))).toEqual({ ok: false, reason: 'too-large' })
    }
  })

  it('超限就取消读取，不继续吞后续块', async () => {
    const cancel = vi.fn()
    let pulls = 0
    const body = new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(8193)); if (pulls === 2) controller.close() }, cancel,
    }, { highWaterMark: 0 })
    const request = new Request('https://example.test/', { method: 'POST', body, duplex: 'half' } as RequestInit)
    expect(await readJson(request)).toEqual({ ok: false, reason: 'too-large' })
    expect(pulls).toBe(1)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('声明超大体积时直接取消流，不读取内容', async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController) => { controller.enqueue(new TextEncoder().encode('{}')); controller.close() })
    const cancel = vi.fn()
    const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 })
    const request = new Request('https://example.test/', { method: 'POST', body, headers: { 'Content-Length': '8193' }, duplex: 'half' } as RequestInit)
    expect(await readJson(request)).toEqual({ ok: false, reason: 'too-large' })
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('正确解码跨块的中文，畸形 JSON 返回错误', async () => {
    const bytes = new TextEncoder().encode('{"text":"虫"}')
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 10)); c.enqueue(bytes.slice(10)); c.close() } })
    const request = new Request('https://example.test/', { method: 'POST', body, duplex: 'half' } as RequestInit)
    expect(await readJson(request)).toEqual({ ok: true, value: { text: '虫' } })
    expect(await readJson(req('{'))).toEqual({ ok: false, reason: 'bad-json' })
  })
})
