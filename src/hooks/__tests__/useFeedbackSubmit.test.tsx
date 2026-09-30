/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFeedbackSubmit, type SubmitResult } from '../useFeedbackSubmit'

vi.mock('../../analytics', () => ({ EVENTS: { FEEDBACK_SUBMIT: 'feedback_submit' }, track: vi.fn() }))
const input = { kind: 'note' as const, body: '保留这段内容', species: null, part: null, email: null }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('提交反馈的时间与响应契约', () => {
  it('15 秒无响应时中止请求，并返回超时结果', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal as AbortSignal
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const { result } = renderHook(() => useFeedbackSubmit('zh'))
    let pending!: Promise<SubmitResult>
    act(() => { pending = result.current(input) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(signal?.aborted).toBe(true)
    expect(await pending).toBe('timeout')
  })

  it('成功后取消超时计时器', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }))
    const { result } = renderHook(() => useFeedbackSubmit('en'))
    expect(await result.current(input)).toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([new Response('<html>SPA fallback</html>'), new Response('{"ok":false}')])('HTTP 200 但没有确认收件时不能清空草稿', async (response) => {
    vi.stubGlobal('fetch', async () => response)
    const { result } = renderHook(() => useFeedbackSubmit('zh'))
    expect(await result.current(input)).toBe('net')
  })

  it('413 映射到表单校验错误', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 413 }))
    const { result } = renderHook(() => useFeedbackSubmit('zh'))
    expect(await result.current(input)).toBe('invalid')
  })
})
