import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createModelCache } from '../modelCache'
import type { InsectModel } from '../builders/kit'

function model(geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial()): InsectModel {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, [material, material]))
  return { group, anchors: {}, radius: 1 }
}

describe('模型 lease 与资源生命周期', () => {
  it('待构建的引用同步保留，两个消费者共享一次构建；只释放一个不能逐出', async () => {
    const cache = createModelCache(1)
    let finish!: (m: InsectModel) => void
    const pending = new Promise<InsectModel>((resolve) => { finish = resolve })
    const build = vi.fn(() => pending)
    const first = cache.acquire('active', build)
    const second = cache.acquire('active', build)
    await cache.load('other', async () => model())
    const active = model()
    finish(active)
    expect(await first.promise).toBe(active)
    expect(await second.promise).toBe(active)
    expect(build).toHaveBeenCalledTimes(1)
    first.release()
    first.release()
    await cache.load('later', async () => model())
    expect(cache.stats().ids).toContain('active')
    second.release()
    await cache.load('last', async () => model())
    expect(cache.stats().ids).toEqual(['last'])
  })

  it('全被引用时允许超过容量，释放后马上回落；当前与离场模型均保持完整', async () => {
    const cache = createModelCache(1)
    const leavingModel = model()
    const dispose = vi.spyOn((leavingModel.group.children[0] as THREE.Mesh).geometry, 'dispose')
    const leaving = cache.acquire('leaving', async () => leavingModel)
    const active = cache.acquire('active', async () => model())
    await Promise.all([leaving.promise, active.promise])
    expect(cache.stats().size).toBe(2)
    expect(dispose).not.toHaveBeenCalled()
    leaving.release()
    expect(cache.stats().ids).toEqual(['active'])
    expect(dispose).toHaveBeenCalledTimes(1)
    active.release()
  })

  it('取消待构建引用与失败任务不会给重试遗留 pin', async () => {
    const cache = createModelCache(1)
    let finish!: (m: InsectModel) => void
    const pending = cache.acquire('cancelled', () => new Promise((resolve) => { finish = resolve }))
    pending.release()
    finish(model())
    await pending.promise
    await cache.load('other', async () => model())
    expect(cache.stats().ids).toEqual(['other'])
    const failed = cache.acquire('failed', async () => { throw new Error('broken') })
    await expect(failed.promise).rejects.toThrow('broken')
    const retry = cache.acquire('failed', async () => model())
    await retry.promise
    failed.release()
    await cache.load('next', async () => model())
    expect(cache.stats().ids).toEqual(['failed'])
    retry.release()
    await cache.load('last', async () => model())
    expect(cache.stats().ids).toEqual(['last'])
  })

  it('同模型资源去重，跨缓存共享资源只在最后一个模型逐出时释放，纹理不释放', async () => {
    const adults = createModelCache(1)
    const stages = createModelCache(1)
    const geometry = new THREE.BoxGeometry()
    const texture = new THREE.Texture()
    const material = new THREE.MeshBasicMaterial({ map: texture })
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')
    const textureDispose = vi.spyOn(texture, 'dispose')
    await adults.load('adult', async () => model(geometry, material))
    await stages.load('egg', async () => model(geometry, material))
    await adults.load('next', async () => model())
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    await stages.load('next', async () => model())
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(textureDispose).not.toHaveBeenCalled()
  })
})
