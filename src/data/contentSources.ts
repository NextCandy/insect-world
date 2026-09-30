/** Evidence is tracked per claim, never as whole-species verification. */
export type ContentClaim =
  | 'japanese-subspecies-length'
  | 'diet-and-range'
  | 'male-combat'

export interface ContentSource {
  id: string
  url: string
  titleKey: 'sources.envTitle' | 'sources.zooTitle' | 'sources.combatTitle'
  supports: readonly ContentClaim[]
  access: 'full-text' | 'official-page'
  checkedAt: string
}

export const CONTENT_SOURCES: Readonly<Record<string, readonly ContentSource[]>> = {
  'rhinoceros-beetle': [
    {
      id: 'env-japanese-subspecies-table',
      url: 'https://www.env.go.jp/content/000283612.pdf',
      titleKey: 'sources.envTitle',
      supports: ['japanese-subspecies-length'],
      access: 'full-text',
      checkedAt: '2026-09-30',
    },
    {
      id: 'tama-zoo-species-page',
      url: 'https://www.tokyo-zoo.net/tama/encyclopedia/japanese-rhinoceros-beetle/index.html',
      titleKey: 'sources.zooTitle',
      supports: ['diet-and-range'],
      access: 'official-page',
      checkedAt: '2026-09-30',
    },
    {
      id: 'buchalski-2019-horn-performance',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6835817/',
      titleKey: 'sources.combatTitle',
      supports: ['male-combat'],
      access: 'full-text',
      checkedAt: '2026-09-30',
    },
  ],
}
