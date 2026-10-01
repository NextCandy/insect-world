import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { InsectModel } from '../three/builders/kit'

/** Acquire must reserve synchronously, before any async import or build. */
interface Lease { promise: Promise<InsectModel>; release: () => void }
interface Held { model: InsectModel | null; release: () => void; accepted: boolean; committed: boolean; requestAlive: boolean }
interface Display { current: Held | null; leaving: Held | null }
interface Options {
  keepLeaving?: boolean
  onLoadStart?: () => void
  onLoaded?: (model: InsectModel) => void
  onError?: (error: unknown) => void
}

/** Keep adopted leases through the commit removing their current/outgoing objects. */
export function useModelLease(key: string, acquire: () => Lease, options: Options = {}) {
  const [display, setDisplay] = useState<Display>({ current: null, leaving: null })
  const held = useRef(new Set<Held>())
  const callbacks = useRef({ acquire, ...options })
  callbacks.current = { acquire, ...options }

  useLayoutEffect(() => {
    for (const entry of held.current) {
      if (entry === display.current || entry === display.leaving) entry.committed = true
      // 一个仍在当前请求、尚未提交的结果不能被另一次高优先级提交提前释放。
      if (entry.accepted && (entry.committed || !entry.requestAlive) && entry !== display.current && entry !== display.leaving) {
        entry.release()
        held.current.delete(entry)
      }
    }
  }, [display])

  useEffect(() => () => {
    for (const entry of held.current) entry.release()
    held.current.clear()
  }, [])

  useEffect(() => {
    let alive = true
    setDisplay(previous => ({
      current: null,
      leaving: callbacks.current.keepLeaving === false ? null : previous.current ?? previous.leaving,
    }))
    callbacks.current.onLoadStart?.()
    let lease: Lease
    try {
      lease = callbacks.current.acquire()
    } catch (error) {
      callbacks.current.onError?.(error)
      return
    }
    let released = false
    const entry: Held = {
      model: null,
      accepted: false,
      committed: false,
      requestAlive: true,
      release: () => {
        if (released) return
        released = true
        lease.release()
      },
    }
    held.current.add(entry)
    lease.promise.then(model => {
      if (!alive) return
      entry.model = model
      entry.accepted = true
      setDisplay(previous => alive ? { ...previous, current: entry } : previous)
      callbacks.current.onLoaded?.(model)
    }, error => {
      entry.release()
      held.current.delete(entry)
      if (alive) callbacks.current.onError?.(error)
    })
    return () => {
      alive = false
      entry.requestAlive = false
      if (!entry.accepted) {
        entry.release()
        held.current.delete(entry)
      }
    }
  }, [key])

  const finishLeaving = useCallback(() => setDisplay(previous => ({ ...previous, leaving: null })), [])
  return { model: display.current?.model ?? null, leaving: display.leaving?.model ?? null, finishLeaving }
}
