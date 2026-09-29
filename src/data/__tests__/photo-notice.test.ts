import { describe, expect, it } from 'vitest'
import { renderPhotoNotice } from '../../../scripts/photo-notice.mjs'

describe('照片署名清单', () => {
  it('从元数据计数并转义摄影者名字中的 Markdown 竖线', () => {
    const notice = renderPhotoNotice({
      sample: { photoId: 42, photographer: 'Sakern | 永隔一江水', license: 'cc-by-nc', inatUrl: 'https://example.org/42' },
      second: { photoId: 43, photographer: 'Another', license: 'cc-by', inatUrl: 'https://example.org/43' },
    })
    expect(notice).toContain('共 2 张，其中禁商用 1 张。')
    expect(notice).toContain('| `sample` | Sakern \\| 永隔一江水 | cc-by-nc ⚠ | [42](https://example.org/42) |')
  })
})
