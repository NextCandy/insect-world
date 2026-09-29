#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkPhotoNotice, writePhotoNotice } from './photo-notice.mjs'

const root = resolve(import.meta.dirname, '..')
if (process.argv.includes('--check')) {
  if (!checkPhotoNotice(root)) {
    console.error('NOTICE-photos.md 与 src/data/photos.json 不一致；运行 npm run photos:notice 更新')
    process.exitCode = 1
  }
} else {
  const photos = JSON.parse(readFileSync(resolve(root, 'src/data/photos.json'), 'utf8'))
  writePhotoNotice(photos, root)
  console.log('✓ 写入 NOTICE-photos.md')
}
