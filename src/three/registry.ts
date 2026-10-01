/**
 * 物种模型注册表
 *
 * 每个物种的几何生成代码有数百行，全部静态引入会让首屏白等。
 * 这里按 id 动态 import，Vite 会为每个物种切出独立 chunk，
 * 只在用户点到它时才下载并构建。构建结果按 id 缓存，切回来时瞬时。
 */
import type { InsectModel } from './builders/kit'
import { pspan, ptrack } from '../perf'
import { createModelCache, type ModelLease } from './modelCache'
export type { ModelLease } from './modelCache'

type Loader = () => Promise<Record<string, unknown>>

/**
 * 用 glob 而不是逐条写 import()：物种文件按 id 命名，放进目录就自动注册。
 * 逐条写的话，任何一个文件缺失都会让 Vite 在转换期整站报错，
 * 而这里缺失只表现为「该物种未注册」，不牵连其余 11 种。
 */
const MODULES = import.meta.glob('./builders/*.ts') as Record<string, Loader>

/**
 * 工具模块：与物种文件同住 builders/ 目录，但不是物种。
 * glob 分不出这两类，全靠这份名单 —— 新增工具文件必须在此登记，
 * 否则它会被当成「幽灵物种」注册进来，layers.test.ts 的孤儿检查会立刻抓住
 * （surface.ts / eyes.ts 落地当天就被抓过一次）。
 *
 * ⚠️ 导出是为了让那条孤儿检查 import 这一份，而不是自己再抄一份。
 * 抄一份的后果实测过（2026-08-09 变异测试）：从这里删掉 'venation' 后
 * venation.ts 被当成物种注册，而测试因为自己那份名单里也有 'venation'
 * 照样全绿 —— 守卫被它要守的东西的副本挡住了。
 */
export const UTILITY_MODULES = new Set(['kit', 'surface', 'eyes', 'venation'])

const LOADERS: Record<string, Loader> = Object.fromEntries(
  Object.entries(MODULES)
    .map(([path, load]) => [path.replace('./builders/', '').replace(/\.ts$/, ''), load] as const)
    // __tests__ 不会被上面的 glob 匹配到
    .filter(([id]) => !UTILITY_MODULES.has(id)),
)

/** 12 个已构建模型；展示/离场 lease 保护活跃引用，全部活跃时暂时溢出。 */
const cache = createModelCache(12)
// 模块预取与真正加载共享任务；成功模块可复用，失败请求必须允许重试。
const modules = new Map<string, Promise<Record<string, unknown>>>()

function loadModule(id: string, loader: Loader): Promise<Record<string, unknown>> {
  const pending = modules.get(id)
  if (pending) return pending
  const task = loader().catch((err) => {
    modules.delete(id)
    throw err
  })
  modules.set(id, task)
  return task
}

/** 仅供测试观察缓存规模 */
export function cacheStats(): { size: number; ids: string[] } {
  return cache.stats()
}

/** 从模块里挑出那个 buildXxx 函数 —— 各文件导出名不同，按前缀找 */
function pickBuilder(mod: Record<string, unknown>): () => InsectModel {
  for (const [key, val] of Object.entries(mod)) {
    if (key.startsWith('build') && typeof val === 'function') {
      return val as () => InsectModel
    }
  }
  throw new Error('模块中没有找到 build* 导出')
}

/**
 * 该物种的建模文件是否真的被打包进来了。
 *
 * import.meta.glob 在**构建期**解析，所以这个判断反映的是产物里到底有没有
 * 这个模型。界面据此过滤，避免列出一个点开只会转圈的物种 —— 数据层和建模层
 * 分别由不同的人/agent 推进，两边进度不同步是常态，不能指望它们永远一致。
 */
export function isKnownSpecies(id: string): boolean {
  return id in LOADERS
}

/**
 * 产物里全部已注册的物种 id（按字母序）。
 *
 * 给模型调试台用：它要列出的是**所有存在的建模文件**，而不是图鉴数据里的物种。
 * 两者不一样 —— 新物种总是先有模型后有数据，调试台若跟着数据走，
 * 新做的模型反而看不到，而目视验收恰恰是新模型最需要的一关。
 */
export function knownSpecies(): string[] {
  return Object.keys(LOADERS).sort()
}

function buildModel(id: string): Promise<InsectModel> {
  const loader = LOADERS[id]
  if (!loader) return Promise.reject(new Error(`未注册的物种：${id}`))
  // 两段分开计时：chunk 下载+求值 vs builder 真正构建几何。
  return ptrack(`chunk:${id}`, loadModule(id, loader))
    .then((mod) => pspan(`build:${id}`, () => pickBuilder(mod)()))
}

/** 兼容预热/调试入口；展示者必须持有 acquireInsectModel 返回的 lease。 */
export function loadInsectModel(id: string): Promise<InsectModel> {
  return cache.load(id, () => buildModel(id))
}

/** 在下载开始的同一同步调用中保留引用；完成、取消或离场后 release。 */
export function acquireInsectModel(id: string): ModelLease {
  return cache.acquire(id, () => buildModel(id))
}

/** 预热只拉取模块；真正选中时才构建模型，不让悬停触发 LRU 逐出。 */
export function prefetchInsectModel(id: string): void {
  const loader = LOADERS[id]
  if (!loader) return
  void loadModule(id, loader).catch(() => {
    /* 预热失败无所谓，真正选中时会再试一次并显示错误 */
  })
}
