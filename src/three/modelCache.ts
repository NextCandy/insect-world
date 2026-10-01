import type { InsectModel } from './builders/kit'
import type * as THREE from 'three'

export type ModelLease = { promise: Promise<InsectModel>; release: () => void }
type Resource = THREE.BufferGeometry | THREE.Material
// 两个缓存共用资源账本；纹理由 surface/eyes 等工具模块共享，不属于模型。
const resourceReferences = new WeakMap<Resource, number>()

function retainResources(model: InsectModel): Set<Resource> {
  const resources = new Set<Resource>()
  model.group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    resources.add(mesh.geometry)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(material)
  })
  for (const resource of resources) resourceReferences.set(resource, (resourceReferences.get(resource) ?? 0) + 1)
  return resources
}

function releaseResources(resources: Set<Resource>): void {
  for (const resource of resources) {
    const remaining = (resourceReferences.get(resource) ?? 1) - 1
    if (remaining > 0) resourceReferences.set(resource, remaining)
    else {
      resourceReferences.delete(resource)
      resource.dispose()
    }
  }
}

type Entry = {
  promise: Promise<InsectModel>
  pins: number
  resources?: Set<Resource>
}

/** LRU 只计已构建模型；待构建任务独立去重，引用在任何异步工作之前保留。 */
export function createModelCache(limit: number): {
  load: (id: string, build: () => Promise<InsectModel>) => Promise<InsectModel>
  acquire: (id: string, build: () => Promise<InsectModel>) => ModelLease
  stats: () => { size: number; ids: string[] }
} {
  const ready = new Map<string, Entry>()
  const inflight = new Map<string, Entry>()

  function trim(): void {
    while (ready.size > limit) {
      const oldest = [...ready].find(([, entry]) => entry.pins === 0)
      if (!oldest) return // 活跃引用可以暂时超过上限；最后一个 release 再 trim。
      ready.delete(oldest[0])
      releaseResources(oldest[1].resources!)
    }
  }

  function entryFor(id: string, build: () => Promise<InsectModel>, pins = 0): Entry {
    const hit = ready.get(id)
    if (hit) {
      ready.delete(id)
      ready.set(id, hit)
      hit.pins += pins
      return hit
    }
    const pending = inflight.get(id)
    if (pending) {
      pending.pins += pins
      return pending
    }
    // build 通常返回动态 import 的 Promise；同步异常也统一走失败清理。
    const entry: Entry = { pins, promise: undefined! }
    inflight.set(id, entry)
    try {
      entry.promise = build().then((model) => {
        entry.resources = retainResources(model)
        inflight.delete(id)
        ready.set(id, entry)
        trim()
        return model
      }).catch((error) => {
        inflight.delete(id)
        throw error
      })
    } catch (error) {
      inflight.delete(id)
      entry.promise = Promise.reject(error)
    }
    return entry
  }

  return {
    load: (id, build) => entryFor(id, build).promise,
    acquire: (id, build) => {
      const entry = entryFor(id, build, 1)
      let released = false
      return {
        promise: entry.promise,
        release: () => {
          if (released) return
          released = true
          entry.pins--
          trim()
        },
      }
    },
    stats: () => ({ size: ready.size, ids: [...ready.keys()] }),
  }
}
