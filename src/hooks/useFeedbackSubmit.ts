import { useCallback, useRef } from 'react'
import type { Locale } from '../i18n/types'
import type { CleanSubmission } from '../feedback/types'
import { EVENTS, track } from '../analytics'

/**
 * 纠错表单的提交。
 *
 * 失败从不 throw，只返回一个错误码给表单显示 —— 后端缺席（D1 没绑好、
 * 断网）时前端照样完好，只是这一条没发出去。
 *
 * 这个文件原先叫 useWall.ts，还管着点播墙的取数与投票；墙在 2026-09-23
 * 按上线时定好的标准撤掉了（15 天 8 票，与观察笔记同一量级），只剩提交。
 */

/** 区分校验、限流、网络故障与等待超时；失败时表单保留草稿。 */
export type SubmitResult = 'ok' | 'invalid' | 'rate' | 'net' | 'timeout'

export type SubmitInput = Omit<CleanSubmission, 'locale'> & {
  /** 蜜罐字段。表单里对真人隐藏，这里原样透传给服务端判定。 */
  website?: string
}

/** 提交一条反馈。 */
export function useFeedbackSubmit(locale: Locale) {
  const pendingDraft = useRef<{ payload: string; requestId: string } | null>(null)
  return useCallback(
    async (input: SubmitInput): Promise<SubmitResult> => {
      const submission = { kind: input.kind, species: input.species, part: input.part, body: input.body, email: input.email, website: input.website, locale }
      const payload = JSON.stringify(submission)
      if (pendingDraft.current?.payload !== payload) {
        try {
          pendingDraft.current = { payload, requestId: crypto.randomUUID() }
        } catch {
          return 'net'
        }
      }
      const draft = pendingDraft.current
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout>
      const deadline = new Promise<SubmitResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          resolve('timeout')
        }, 15_000)
      })
      const submit = async (): Promise<SubmitResult> => {
        try {
          const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...submission, requestId: draft.requestId }),
            signal: controller.signal,
          })
          if (res.ok) {
            const receipt: unknown = await res.json()
            if (controller.signal.aborted) return 'timeout'
            // SPA 回落页或错误 JSON 的 HTTP 200 不能被当作收件确认、清掉草稿。
            if (!receipt || typeof receipt !== 'object' || !('ok' in receipt) || receipt.ok !== true) return 'net'
            if (pendingDraft.current === draft) pendingDraft.current = null
            track(EVENTS.FEEDBACK_SUBMIT, { kind: input.kind })
            return 'ok'
          }
          if (res.status === 429) return 'rate'
          if (res.status === 400 || res.status === 409 || res.status === 413) return 'invalid'
          return 'net'
        } catch {
          // 断网、被拦截、后端还没部署 —— 对用户都是同一件事：没发出去，回头再试
          return controller.signal.aborted ? 'timeout' : 'net'
        }
      }
      try {
        return await Promise.race([submit(), deadline])
      } finally {
        clearTimeout(timer!)
      }
    },
    [locale],
  )
}
