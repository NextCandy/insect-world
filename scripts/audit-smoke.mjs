/** 浏览器回归检查：先 npm run build，再 npm run test:browser。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:4179'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4179', '--strictPort'], { stdio: 'pipe' })
let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk })
server.stderr.on('data', (chunk) => { serverOutput += chunk })
let browser
let checks = 0
async function testPage(options = {}) {
  const page = await browser.newPage(options)
  page.setDefaultTimeout(15000)
  // 回归检查不向正式统计写入测试流量，也不依赖第三方脚本的存储行为。
  await page.route('https://analytics.fojin.app/**', (route) => route.abort())
  return page
}
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`预览服务启动失败：${serverOutput}`)
    try { ready = (await fetch(base)).ok } catch { /* 等待服务监听 */ }
    if (ready) break
    await delay(100)
  }
  assert.ok(ready, '预览服务未就绪')
  browser = await chromium.launch({ headless: true })

  // 中文、英文与长物种名，覆盖身份区和生活史入口曾经重叠的窄屏。
  for (const path of ['/', '/en/', '/en/s/swallowtail/']) {
    for (const width of [320, 390, 640]) {
      const page = await testPage({ viewport: { width, height: 844 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}${path}`)
      await page.locator('.stage-height canvas').waitFor()
      await page.evaluate(() => document.fonts.ready)
      const layout = await page.evaluate(() => {
        const identity = document.querySelector('[class*="identity"]')
        const labels = identity ? [...identity.children].map((node) => node.getBoundingClientRect()) : []
        const cue = document.querySelector('[class*="lifeCue"]')?.getBoundingClientRect()
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          overlap: cue && labels.some((label) => label.left < cue.right && label.right > cue.left && label.top < cue.bottom && label.bottom > cue.top),
          touchSize: cue ? Math.min(cue.width, cue.height) : 0,
        }
      })
      assert.equal(layout.overflow, false, `${path} ${width}px 横向溢出`)
      assert.equal(layout.overlap, false, `${path} ${width}px 物种名与入口重叠`)
      assert.ok(layout.touchSize >= 44, `${path} ${width}px 生活史入口触控区域不足`)
      assert.deepEqual(errors, [], `${path} ${width}px 页面异常`)
      await page.close()
      checks++
    }
  }

  const page = await testPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}/s/tiger-beetle/`)
  const button = page.getByTitle('换一只看看')
  await button.waitFor()
  const before = await page.title()
  await button.click()
  await page.waitForFunction((title) => document.title !== title, before)
  checks++
  await page.close()

  // 真实浏览器禁用 Storage，包括 getter 抛错与读写抛错两种情况。
  for (const failure of ['getter', 'methods']) {
    const blocked = await testPage({ locale: 'en-US' })
    const errors = []
    blocked.on('pageerror', (error) => errors.push(error.message))
    await blocked.addInitScript((mode) => {
      const denied = () => { throw new DOMException('Storage blocked', 'SecurityError') }
      if (mode === 'getter') Object.defineProperty(window, 'localStorage', { get: denied })
      else { Storage.prototype.getItem = denied; Storage.prototype.setItem = denied }
    }, failure)
    await blocked.goto(base)
    await blocked.getByLabel('切换到深色主题').click()
    await blocked.getByLabel('切换到浅色主题').waitFor()
    await blocked.getByLabel('Dismiss').click()
    assert.equal(await blocked.getByRole('note').count(), 0)
    assert.deepEqual(errors, [], `Storage ${failure} 被拒绝时页面异常`)
    await blocked.close()
    checks++
  }
  console.log(`✓ 浏览器回归 ${checks} 个场景通过（窄屏布局、换虫、存储故障）`)
} finally {
  try { await browser?.close() } finally { server.kill('SIGTERM') }
}
