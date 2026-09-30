import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InsectModel } from '../builders/kit'
import type * as THREE from 'three'

const adultModules = import.meta.glob('../builders/*.ts')

const cases = [
  { kind: '成虫', module: '../builders/ant', builder: 'buildAnt', registry: '../registry', id: 'ant' },
  { kind: '阶段', module: '../builders/stages/cicada-egg', builder: 'buildCicadaEgg', registry: '../stages', id: 'cicada' },
] as const

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// 使用真实 builder；只在模块导入边界制造网络失败/延迟，观察模型缓存与构建。
for (const fixture of cases) {
  describe(`${fixture.kind}只预取模块`, () => {
    beforeEach(() => vi.resetModules())
    afterEach(() => {
      vi.doUnmock(fixture.module)
      vi.resetModules()
    })

    async function api() {
      if (fixture.kind === '成虫') {
        const r = await import('../registry')
        return { prefetch: () => r.prefetchInsectModel(fixture.id), load: () => r.loadInsectModel(fixture.id), size: () => r.cacheStats().size }
      }
      const r = await import('../stages')
      return { prefetch: () => r.prefetchStages(fixture.id), load: () => r.loadStageModel(fixture.id, 'egg'), size: () => r.stageCacheStats().size }
    }

    it('预取完成后不构建模型、不增加缓存；实际加载才构建并保留同一实例', async () => {
      let evaluated = false
      const actual = await vi.importActual<Record<string, () => InsectModel>>(fixture.module)
      const build = vi.fn(actual[fixture.builder])
      vi.doMock(fixture.module, () => {
        evaluated = true
        return { ...actual, [fixture.builder]: build }
      })
      const r = await api()
      r.prefetch()
      r.prefetch()
      await vi.waitFor(() => expect(evaluated).toBe(true))
      await settle()
      expect(build).not.toHaveBeenCalled()
      expect(r.size()).toBe(0)

      const [first, simultaneous] = await Promise.all([r.load(), r.load()])
      expect(first.radius).toBeGreaterThan(0)
      expect(simultaneous).toBe(first)
      expect(await r.load()).toBe(first)
      expect(build).toHaveBeenCalledTimes(1)
    })

    it('真正加载与未完成的预取共享模块任务，完成后只构建一次', async () => {
      const actual = await vi.importActual<Record<string, () => InsectModel>>(fixture.module)
      const build = vi.fn(actual[fixture.builder])
      let finish!: () => void
      let importing = false
      const pending = new Promise<void>((resolve) => { finish = resolve })
      vi.doMock(fixture.module, async () => {
        importing = true
        await pending
        return { ...actual, [fixture.builder]: build }
      })
      const r = await api()
      r.prefetch()
      await vi.waitFor(() => expect(importing).toBe(true))
      const load = r.load()
      expect(build).not.toHaveBeenCalled()
      finish()
      const model = await load
      expect(model.radius).toBeGreaterThan(0)
      expect(await r.load()).toBe(model)
      expect(build).toHaveBeenCalledTimes(1)
    })

    it('失败的预取不会留下拒绝任务；真正加载可以重新导入', async () => {
      let attempted = false
      vi.doMock(fixture.module, () => {
        attempted = true
        throw new Error('临时模块下载失败')
      })
      const r = await api()
      r.prefetch()
      await vi.waitFor(() => expect(attempted).toBe(true))
      await settle()
      expect(r.size()).toBe(0)

      // 新请求能得到成功响应，不应被注册表里先前的拒绝 Promise 卡住。
      const actual = await vi.importActual<Record<string, () => InsectModel>>(fixture.module)
      vi.doMock(fixture.module, () => actual)
      const model = await r.load()
      expect(model.radius).toBeGreaterThan(0)
      expect(await r.load()).toBe(model)
    })
  })
}

it('连续预取超过 LRU 容量的成虫模块，不逐出或 dispose 当前模型', async () => {
  vi.resetModules()
  const r = await import('../registry')
  const active = await r.loadInsectModel('ant')
  let disposals = 0
  active.group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.addEventListener('dispose', () => { disposals++ })
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.addEventListener('dispose', () => { disposals++ })
    }
  })
  const ids = r.knownSpecies().filter((id) => id !== 'ant').slice(0, 20)
  for (const id of ids) r.prefetchInsectModel(id)
  await Promise.all(ids.map((id) => adultModules[`../builders/${id}.ts`]()))
  await settle()
  expect(r.cacheStats().ids).toEqual(['ant'])
  expect(disposals).toBe(0)
  expect(await r.loadInsectModel('ant')).toBe(active)
  vi.resetModules()
})
