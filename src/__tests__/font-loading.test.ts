/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const source = () => readFileSync(resolve(process.cwd(), 'public/font-boot.js'), 'utf8')
const run = () => new Function(source())()

beforeEach(() => {
  document.head.innerHTML = '<link rel="stylesheet" data-iw-fonts media="print">'
})

describe('非阻塞字体加载', () => {
  it('样式表加载后启用屏幕媒体', () => {
    const link = document.querySelector<HTMLLinkElement>('[data-iw-fonts]')!
    run()
    link.dispatchEvent(new Event('load'))
    expect(link.media).toBe('all')
  })

  it('加载事件先于脚本执行时也启用字体', () => {
    const link = document.querySelector<HTMLLinkElement>('[data-iw-fonts]')!
    Object.defineProperty(link, 'sheet', { configurable: true, value: {} })
    run()
    expect(link.media).toBe('all')
  })

  it.each(['index.html', 'en/index.html'])('%s 不使用被 CSP 拦截的内联事件', (file) => {
    const html = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(html).toContain('data-iw-fonts')
    expect(html).toContain('/font-boot.js')
    expect(html).not.toMatch(/\bonload=/)
  })
})
