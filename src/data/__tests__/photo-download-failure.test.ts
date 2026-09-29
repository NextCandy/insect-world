import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('照片构建失败兜底', () => {
  it('新照片下载失败时不会继续发布该物种的旧照片', () => {
    const root = mkdtempSync(join(tmpdir(), 'iw-photo-'))
    try {
      mkdirSync(join(root, 'scripts'))
      mkdirSync(join(root, 'src/data'), { recursive: true })
      mkdirSync(join(root, 'public/photos'), { recursive: true })
      copyFileSync(resolve(process.cwd(), 'scripts/download-photos.mjs'), join(root, 'scripts/download-photos.mjs'))
      writeFileSync(join(root, 'src/data/photos.json'), JSON.stringify({ sample: {
        photoId: 2, url: 'https://example.invalid/new.jpg', ext: 'jpg',
      } }))
      writeFileSync(join(root, 'public/photos/sample.jpg'), 'old photographer image')
      const stub = join(root, 'fail-fetch.mjs')
      writeFileSync(stub, 'globalThis.fetch = async () => { throw new Error("offline") }')

      const result = spawnSync(process.execPath, ['--import', stub, join(root, 'scripts/download-photos.mjs')], {
        cwd: root, encoding: 'utf8', env: { ...process.env, CI: '' },
      })
      expect(result.status).toBe(0)
      expect(existsSync(join(root, 'public/photos/sample.jpg'))).toBe(false)
      const sums = JSON.parse(readFileSync(join(root, 'public/photos/checksums.json'), 'utf8'))
      expect(sums).toEqual({})
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
