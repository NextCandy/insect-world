/**
 * 生活史阶段的模型注册表。
 *
 * ## 为什么阶段模型单独放一个目录，不跟成虫挤一个文件
 *
 * 三条理由，第一条是硬的：
 *
 * 1. **`registry.ts` 的 `pickBuilder()` 取的是第一个 `build*` 导出。** 同一个文件里
 *    再多出 `buildXxxLarva` / `buildXxxPupa`，选哪个就成了导出名的字典序运气
 *    （模块命名空间对象的键是排序过的，`buildMonarchButterfly` 恰好排在
 *    `buildMonarchButterflyEgg` 前面 —— 靠一个巧合撑着的契约不算契约）。
 * 2. 物种文件已经 200~400 行，塞进三个阶段就是 600~900 行。
 * 3. **懒加载的边界正好落在这儿**：生活史是单独一个视图，不点开就不该下载。
 *    放进 `builders/stages/` 后，`import.meta.glob('./builders/*.ts')` 的 `*`
 *    不跨 `/`，天然不会把阶段文件当成物种注册进去（那会污染 `knownSpecies()`，
 *    并被 `layers.test.ts` 的孤儿检查抓住）。
 *
 * ## 约定
 *
 * - 文件：`builders/stages/<物种id>-<阶段>.ts`
 * - 导出：`build<驼峰物种名><阶段>()`，返回 `InsectModel`（照旧走 `finalize()`）
 * - 单位与坐标系与成虫**完全一致**：1 = 1 厘米真实体长，+X 向前、+Y 向上、+Z 向右
 *
 * 尺度必须按真实比例做，不许为了「好看」把卵放大 —— 卵只有毫米、幼虫比成虫还长，
 * 这种量级差本身就是生活史要讲的内容。取景由 `finalize()` 算出的 `radius` 归一化，
 * 各阶段各自撑满画面，真实大小交给界面用文字说（这跟成虫之间竹节虫 10cm 与
 * 瓢虫 0.7cm 差 20 倍是同一套处理）。
 */
import type { InsectModel } from './builders/kit'
import { createModelCache, type ModelLease } from './modelCache'

/**
 * 阶段。**`larva`/`pupa` 与 `nymph` 不是同义词，是这个功能要讲的那件事本身**：
 * 完全变态（卵→幼虫→蛹→成虫）的幼虫与成虫形态完全不同、中间要经过蛹；
 * 不完全变态（卵→若虫→成虫）的若虫就是缩小版成虫、逐次蜕皮长大，没有蛹期。
 * 把两者混成一个词，等于把中小学讲昆虫的第一个知识点抹掉。
 */
export type LifeStage = 'egg' | 'larva' | 'pupa' | 'nymph' | 'adult'

/** 完全变态的阶段序列 */
export const HOLOMETABOLOUS: readonly LifeStage[] = ['egg', 'larva', 'pupa', 'adult'] as const
/** 不完全变态的阶段序列 */
export const HEMIMETABOLOUS: readonly LifeStage[] = ['egg', 'nymph', 'adult'] as const

/** 两条路线里，除成虫外需要单独建模的阶段 */
export const BUILT_STAGES: readonly LifeStage[] = ['egg', 'larva', 'pupa', 'nymph'] as const

type Loader = () => Promise<Record<string, unknown>>

/**
 * 与 `registry.ts` 同样用 glob 而不是逐条 import()：放一个文件进去就自动注册。
 * 这里的 key 直接就是文件名 `<id>-<stage>`。
 */
const MODULES = import.meta.glob('./builders/stages/*.ts') as Record<string, Loader>

const LOADERS: Record<string, Loader> = Object.fromEntries(
  Object.entries(MODULES).map(
    ([path, load]) => [path.replace('./builders/stages/', '').replace(/\.ts$/, ''), load] as const,
  ),
)

const key = (speciesId: string, stage: LifeStage) => `${speciesId}-${stage}`

/** 与成虫分开的 12 项 LRU；lease 保留展示和离场模型。 */
const cache = createModelCache(12)
const modules = new Map<string, Promise<Record<string, unknown>>>()

/** 预取与展示共享模块任务，拒绝任务清掉后允许真正展示时重试。 */
function loadModule(k: string, loader: Loader): Promise<Record<string, unknown>> {
  const pending = modules.get(k)
  if (pending) return pending
  const task = loader().catch((err) => {
    modules.delete(k)
    throw err
  })
  modules.set(k, task)
  return task
}

/** 从模块里挑 build* 导出。阶段文件**只准有一个** —— 多个就是把两个阶段写进了同一个文件。 */
function pickBuilder(mod: Record<string, unknown>, id: string): () => InsectModel {
  const found = Object.entries(mod).filter(([k, v]) => k.startsWith('build') && typeof v === 'function')
  if (found.length === 0) throw new Error(`${id}：阶段模块里没有 build* 导出`)
  if (found.length > 1) {
    throw new Error(
      `${id}：阶段模块有 ${found.length} 个 build* 导出（${found.map(([k]) => k).join(', ')}）。` +
        '一个文件只装一个阶段 —— 多个导出时选哪个会退化成字典序运气。',
    )
  }
  return found[0][1] as () => InsectModel
}

/** 这个物种的这个阶段有没有建模文件（构建期决议，反映产物里到底有没有） */
export function hasStage(speciesId: string, stage: LifeStage): boolean {
  return key(speciesId, stage) in LOADERS
}

/** 这个物种做了哪些阶段（不含成虫；成虫永远走 `registry.ts`） */
export function builtStagesOf(speciesId: string): LifeStage[] {
  return BUILT_STAGES.filter((s) => hasStage(speciesId, s))
}

/** 产物里有阶段模型的全部物种 id（按字母序），给测试与调试台用 */
export function speciesWithStages(): string[] {
  const ids = new Set<string>()
  for (const k of Object.keys(LOADERS)) {
    const m = k.match(/^(.*)-(egg|larva|pupa|nymph)$/)
    if (m) ids.add(m[1])
  }
  return [...ids].sort()
}

/**
 * 这个物种走哪条变态路线 —— 按它实际做了哪些阶段判断，不另设一张表。
 * 有蛹就是完全变态；有若虫就是不完全变态。两者都没有则返回 null。
 *
 * 不另设表是有意的：表和文件两处都能改，迟早对不上；让文件本身当唯一事实来源。
 */
export function metamorphosisOf(speciesId: string): readonly LifeStage[] | null {
  if (hasStage(speciesId, 'pupa')) return HOLOMETABOLOUS
  if (hasStage(speciesId, 'nymph')) return HEMIMETABOLOUS
  return null
}

function buildStage(k: string): Promise<InsectModel> {
  const loader = LOADERS[k]
  if (!loader) return Promise.reject(new Error(`未注册的生活史阶段：${k}`))
  return loadModule(k, loader).then((mod) => pickBuilder(mod, k)())
}

/** 兼容调试入口；展示者必须持有 acquireStageModel 返回的 lease。 */
export function loadStageModel(speciesId: string, stage: LifeStage): Promise<InsectModel> {
  const k = key(speciesId, stage)
  return cache.load(k, () => buildStage(k))
}

/** 同步保护待构建模型；release 幂等，也可在 Promise 完成之前取消。 */
export function acquireStageModel(speciesId: string, stage: LifeStage): ModelLease {
  const k = key(speciesId, stage)
  return cache.acquire(k, () => buildStage(k))
}

/** 预热整条路线的模块；不构建几何，也不把未展示的阶段放进模型缓存。 */
export function prefetchStages(speciesId: string): void {
  for (const stage of builtStagesOf(speciesId)) {
    const k = key(speciesId, stage)
    void loadModule(k, LOADERS[k]).catch(() => {
      /* 预热失败无所谓，真正打开时会再试一次并显示错误 */
    })
  }
}

/** 仅供测试观察缓存规模 */
export function stageCacheStats(): { size: number; keys: string[] } {
  const { size, ids } = cache.stats()
  return { size, keys: ids }
}
