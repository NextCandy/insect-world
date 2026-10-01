/** @vitest-environment jsdom */
import { StrictMode, useState, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
import type { InsectModel } from '../../three/builders/kit'
import { useModelLease } from '../useModelLease'

function lease(name: string) {
  const model: InsectModel = { group: new Group(), anchors: {}, radius: 1 }
  model.group.name = name
  let resolve!: (model: InsectModel) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<InsectModel>((yes, no) => { resolve = yes; reject = no })
  const release = vi.fn()
  return { model, promise, release, resolve: () => resolve(model), reject }
}
function Harness({ id, acquire, keepLeaving = true }: { id: string; acquire: () => ReturnType<typeof lease>; keepLeaving?: boolean }) {
  const { model, leaving, finishLeaving } = useModelLease(id, acquire, { keepLeaving })
  return <><span data-testid="current">{model?.group.name}</span><span data-testid="leaving">{leaving?.group.name}</span><button onClick={finishLeaving}>finish</button></>
}
afterEach(cleanup)

describe('model consumer lifetime', () => {
  it('keeps outgoing model until removal commits, and releases everything on unmount', async () => {
    const a = lease('a'), b = lease('b')
    const view = render(<Harness id="a" acquire={() => a} />)
    await act(async () => a.resolve())
    view.rerender(<Harness id="b" acquire={() => b} />)
    expect(screen.getByTestId('current').textContent).toBe('')
    expect(screen.getByTestId('leaving').textContent).toBe('a')
    expect(a.release).not.toHaveBeenCalled()
    await act(async () => b.resolve())
    expect(screen.getByTestId('current').textContent).toBe('b')
    expect(a.release).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('finish'))
    expect(a.release).toHaveBeenCalledTimes(1)
    expect(b.release).not.toHaveBeenCalled()
    view.unmount()
    expect(b.release).toHaveBeenCalledTimes(1)
  })
  it('release callbacks observe the old display already removed from the committed tree', async () => {
    const a = lease('a'), b = lease('b')
    a.release.mockImplementation(() => expect(screen.queryByTestId('leaving')?.textContent ?? '').not.toBe('a'))
    const view = render(<Harness id="a" acquire={() => a} />)
    await act(async () => a.resolve())
    view.rerender(<Harness id="b" acquire={() => b} />)
    await act(async () => b.resolve())
    fireEvent.click(screen.getByText('finish'))
    expect(a.release).toHaveBeenCalledTimes(1)
    b.release.mockImplementation(() => expect(screen.queryByTestId('current')).toBeNull())
    view.unmount()
    expect(b.release).toHaveBeenCalledTimes(1)
  })
  it('releases canceled pending requests immediately and ignores stale success', async () => {
    const a = lease('a'), b = lease('b')
    const view = render(<Harness id="a" acquire={() => a} />)
    view.rerender(<Harness id="b" acquire={() => b} />)
    expect(a.release).toHaveBeenCalledTimes(1)
    await act(async () => { a.resolve(); b.resolve() })
    expect(screen.getByTestId('current').textContent).toBe('b')
    expect(a.release).toHaveBeenCalledTimes(1)
  })
  it('rapid switches release replaced outgoing models, preserving the newest outgoing one', async () => {
    const a = lease('a'), b = lease('b'), c = lease('c')
    const view = render(<Harness id="a" acquire={() => a} />)
    await act(async () => a.resolve())
    view.rerender(<Harness id="b" acquire={() => b} />)
    await act(async () => b.resolve())
    view.rerender(<Harness id="c" acquire={() => c} />)
    expect(screen.getByTestId('leaving').textContent).toBe('b')
    expect(a.release).toHaveBeenCalledTimes(1)
    expect(b.release).not.toHaveBeenCalled()
    await act(async () => c.resolve())
  })
  it('failed loads release reservations and preserve the outgoing model', async () => {
    const a = lease('a'), b = lease('b')
    const view = render(<Harness id="a" acquire={() => a} />)
    await act(async () => a.resolve())
    view.rerender(<Harness id="b" acquire={() => b} />)
    await act(async () => b.reject(new Error('failed')))
    expect(b.release).toHaveBeenCalledTimes(1)
    expect(a.release).not.toHaveBeenCalled()
    expect(screen.getByTestId('leaving').textContent).toBe('a')
  })
  it('preview without transitions releases previous model after commit', async () => {
    const a = lease('a'), b = lease('b')
    const view = render(<Harness id="a" acquire={() => a} keepLeaving={false} />)
    await act(async () => a.resolve())
    view.rerender(<Harness id="b" acquire={() => b} keepLeaving={false} />)
    expect(a.release).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('leaving').textContent).toBe('')
    await act(async () => b.resolve())
  })
  it('StrictMode replays acquire and releases canceled first reservation', async () => {
    const a = lease('a'), b = lease('b')
    const acquire = vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b)
    const view = render(<StrictMode><Harness id="a" acquire={acquire} /></StrictMode>)
    expect(a.release).toHaveBeenCalledTimes(1)
    await act(async () => { a.resolve(); b.resolve() })
    expect(screen.getByTestId('current').textContent).toBe('b')
    view.unmount()
    expect(b.release).toHaveBeenCalledTimes(1)
  })
})

it('a synchronous outgoing-removal commit cannot release a queued incoming model', async () => {
  let finish!: () => void
  function Consumer({ id, acquire }: { id: string; acquire: () => ReturnType<typeof lease> }) {
    const display = useModelLease(id, acquire)
    finish = display.finishLeaving
    return <div>{display.model?.group.name}</div>
  }
  const a = lease('a'), b = lease('b')
  const view = render(<Consumer id="a" acquire={() => a} />)
  await act(async () => a.resolve())
  view.rerender(<Consumer id="b" acquire={() => b} />)
  b.resolve()
  await Promise.resolve() // adoption is queued in its default lane
  flushSync(() => finish())
  expect(b.release).not.toHaveBeenCalled()
  await act(async () => {})
  expect(view.container.textContent).toBe('b')
  view.unmount()
  expect(b.release).toHaveBeenCalledTimes(1)
})

it('a queued adoption canceled by a newer key releases once and never becomes outgoing', async () => {
  let switchId!: (id: string) => void
  const a = lease('a'), b = lease('b'), c = lease('c')
  const committed = new Set<string>()
  const leases: Record<string, ReturnType<typeof lease>> = { a, b, c }
  function Consumer() {
    const [id, setId] = useState('a')
    switchId = setId
    const display = useModelLease(id, () => leases[id])
    useLayoutEffect(() => { if (display.model) committed.add(display.model.group.name) }, [display.model])
    return <div>{display.model?.group.name ?? ''}/{display.leaving?.group.name ?? ''}</div>
  }
  const view = render(<Consumer />)
  await act(async () => a.resolve())
  act(() => switchId('b'))
  b.resolve()
  await Promise.resolve()
  flushSync(() => switchId('c'))
  await act(async () => {})
  // React may commit B before the synchronous switch under load. A displayed
  // B must remain outgoing; an uncommitted B must release and never appear.
  if (committed.has('b')) {
    expect(view.container.textContent).toBe('/b')
    expect(b.release).not.toHaveBeenCalled()
    expect(a.release).toHaveBeenCalledTimes(1)
  } else {
    expect(view.container.textContent).toBe('/a')
    expect(b.release).toHaveBeenCalledTimes(1)
    expect(a.release).not.toHaveBeenCalled()
  }
  view.unmount()
  expect(c.release).toHaveBeenCalledTimes(1)
})
