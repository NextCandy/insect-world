import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 为遮住背景的浮层管理键盘焦点、Esc 和滚动，并在卸载时返回入口。 */
export function useModalFocus(panel: RefObject<HTMLElement>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const opener = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  )

  useEffect(() => {
    const el = panel.current
    if (!el) return
    const focusables = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((node) => !node.closest('[hidden], [aria-hidden="true"]'))

    // autoFocus 的表单控件已获得焦点时保留它；其余浮层从第一个按钮进入。
    if (!el.contains(document.activeElement)) (focusables()[0] ?? el).focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        el.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [panel])
}
