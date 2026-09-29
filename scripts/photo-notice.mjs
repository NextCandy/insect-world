import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const escapeCell = (value) => String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function renderPhotoNotice(photos) {
  const entries = Object.entries(photos).sort(([a], [b]) => a.localeCompare(b))
  const nonCommercial = entries.filter(([, photo]) => String(photo.license).includes('-nc')).length
  const lines = [
    '# 实拍照片署名',
    '',
    '本文件由 `npm run photos:notice` 生成，请勿手改。',
    '',
    '站上每只虫的实拍图都来自 [iNaturalist](https://www.inaturalist.org/)，',
    '全部为 Creative Commons 授权。图片旁已逐张署名，这份清单是为了能一次核对完。',
    '',
    '**图片字节不在本仓库内** —— 仓库是 MIT，而下表中带 `NC` 的照片禁止商用，',
    '把它们提交进来会让 MIT 声明变成骗人的。图片由 `scripts/download-photos.mjs`',
    '在构建期抓进 `public/photos/`（已 gitignore）。',
    '',
    `共 ${entries.length} 张，其中禁商用 ${nonCommercial} 张。`,
    '',
    '| 物种 | 摄影 | 许可证 | 原图 |',
    '| --- | --- | --- | --- |',
  ]
  for (const [id, photo] of entries) {
    const nc = String(photo.license).includes('-nc') ? ' ⚠' : ''
    lines.push(`| \`${escapeCell(id)}\` | ${escapeCell(photo.photographer)} | ${escapeCell(photo.license)}${nc} | [${photo.photoId}](${photo.inatUrl}) |`)
  }
  lines.push('', '⚠ = 禁商用（CC-*-NC-*）。这个站一旦要商用，必须先换掉这些图。', '')
  return lines.join('\n')
}

export function writePhotoNotice(photos, root) {
  writeFileSync(resolve(root, 'NOTICE-photos.md'), renderPhotoNotice(photos), 'utf8')
}

export function checkPhotoNotice(root) {
  const photos = JSON.parse(readFileSync(resolve(root, 'src/data/photos.json'), 'utf8'))
  const current = readFileSync(resolve(root, 'NOTICE-photos.md'), 'utf8')
  return current === renderPhotoNotice(photos)
}
