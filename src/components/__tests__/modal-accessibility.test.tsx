/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderZh } from '../../i18n/testing'
import { INSECTS } from '../../data/insects.zh'
import { Gallery } from '../Gallery'
import { NotesPanel } from '../NotesPanel'
import { FeedbackDialog } from '../FeedbackDialog'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

function opener() {
  const button = document.createElement('button')
  document.body.appendChild(button)
  button.focus()
  return button
}

describe('遮住背景的浮层', () => {
  it('图库把 Tab 留在有名称的对话框里，关闭后返回入口', () => {
    const start = opener()
    const { unmount } = renderZh(<Gallery insects={INSECTS} activeId={INSECTS[0].id} onSelect={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: /全部 63 种/ })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const links = dialog.querySelectorAll('a[href]')
    const last = links[links.length - 1] as HTMLElement
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog.querySelector('button'))
    unmount()
    expect(document.activeElement).toBe(start)
  })

  it('笔记浮层与纠错框都有可访问名称', () => {
    opener()
    const insect = INSECTS[0]
    const notes = renderZh(<NotesPanel insect={insect} insects={INSECTS} notes={{}} onWrite={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /笔记/ }).getAttribute('aria-modal')).toBe('true')
    notes.unmount()
    renderZh(<FeedbackDialog insect={insect} focusAnchor={null} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /这里画得不对/ }).getAttribute('aria-modal')).toBe('true')
  })

  it('父组件重渲染更换关闭回调时不移动当前焦点', () => {
    opener()
    const first = vi.fn()
    const view = renderZh(<Gallery insects={INSECTS} activeId={INSECTS[0].id} onSelect={vi.fn()} onClose={first} />)
    const dialog = screen.getByRole('dialog', { name: /全部 63 种/ })
    const target = dialog.querySelector('a[href]') as HTMLElement
    target.focus()
    view.rerender(<Gallery insects={INSECTS} activeId={INSECTS[0].id} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(document.activeElement).toBe(target)
  })
})
