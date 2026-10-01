import { afterEach, expect, it, vi } from 'vitest'
import type * as THREE from 'three'

afterEach(() => vi.resetModules())

it('成虫 lease 同时保护当前与离场模型，真实加载压力不会 dispose 它们', async () => {
  vi.resetModules()
  const r = await import('../registry')
  const current = r.acquireInsectModel('ant')
  const leaving = r.acquireInsectModel('cicada')
  const models = await Promise.all([current.promise, leaving.promise])
  let disposals = 0
  for (const model of models) model.group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.isMesh) mesh.geometry.addEventListener('dispose', () => { disposals++ })
  })
  for (const id of r.knownSpecies().filter((id) => !['ant', 'cicada'].includes(id)).slice(0, 20)) {
    await r.loadInsectModel(id)
  }
  expect(r.cacheStats().size).toBeLessThanOrEqual(12)
  expect(r.cacheStats().ids).toEqual(expect.arrayContaining(['ant', 'cicada']))
  expect(disposals).toBe(0)
  current.release()
  leaving.release()
}, 20_000)

it('生活史连续真实加载48个模型仍保持12个以内，被逐出的可完整重建', async () => {
  vi.resetModules()
  const r = await import('../stages')
  const pairs = r.speciesWithStages().flatMap((id) => r.builtStagesOf(id).map((stage) => ({ id, stage }))).slice(0, 48)
  expect(pairs).toHaveLength(48)
  const first = pairs[0]
  const firstModel = await r.loadStageModel(first.id, first.stage)
  for (const { id, stage } of pairs.slice(1)) {
    const lease = r.acquireStageModel(id, stage)
    expect((await lease.promise).radius).toBeGreaterThan(0)
    lease.release()
    expect(r.stageCacheStats().size).toBeLessThanOrEqual(12)
  }
  expect(r.stageCacheStats().keys).not.toContain(`${first.id}-${first.stage}`)
  const rebuilt = await r.loadStageModel(first.id, first.stage)
  expect(rebuilt).not.toBe(firstModel)
  expect(rebuilt.radius).toBeGreaterThan(0)
  expect(rebuilt.group.children.length).toBeGreaterThan(0)
}, 20_000)

it('未知物种与阶段返回可释放的拒绝 lease，后续合法加载正常', async () => {
  vi.resetModules()
  const adults = await import('../registry')
  const stages = await import('../stages')
  const invalidAdult = adults.acquireInsectModel('missing')
  const invalidStage = stages.acquireStageModel('missing', 'egg')
  invalidAdult.release()
  invalidStage.release()
  await expect(invalidAdult.promise).rejects.toThrow('未注册的物种')
  await expect(invalidStage.promise).rejects.toThrow('未注册的生活史阶段')
  const valid = adults.acquireInsectModel('ant')
  expect((await valid.promise).radius).toBeGreaterThan(0)
  valid.release()
})
