/** Evidence is tracked per claim, never as whole-species verification. */
export type ContentClaim =
  | 'japanese-subspecies-length'
  | 'diet-and-range'
  | 'male-combat'
  | 'aphid-predation'
  | 'adult-length-cornell'
  | 'us-season-and-introduction'
  | 'larval-stages-and-native-range'
  | 'reflex-bleeding'

export interface ContentSource {
  id: string
  url: string
  titleKey: 'sources.envTitle' | 'sources.zooTitle' | 'sources.combatTitle'
    | 'sources.ncLadybirdTitle' | 'sources.cornellLadybirdTitle' | 'sources.adwLadybirdTitle' | 'sources.bleedingTitle'
  supports: readonly ContentClaim[]
  access: 'full-text' | 'official-page' | 'abstract'
  checkedAt: string
}

export const CONTENT_SOURCES: Readonly<Record<string, readonly ContentSource[]>> = {
  ladybird: [
    {
      id: 'nc-state-c7-predation',
      url: 'https://entomology.ces.ncsu.edu/biological-control-information-center/beneficial-predators/c-7-ladybeetle/',
      titleKey: 'sources.ncLadybirdTitle',
      supports: ['aphid-predation'],
      access: 'official-page',
      checkedAt: '2026-10-01',
    },
    {
      id: 'cornell-c7-species-profile',
      url: 'https://biocontrol.entomology.cornell.edu/predators/Coccinella.php',
      titleKey: 'sources.cornellLadybirdTitle',
      supports: ['adult-length-cornell', 'us-season-and-introduction'],
      access: 'official-page',
      checkedAt: '2026-10-01',
    },
    {
      id: 'adw-c7-development-range',
      url: 'https://animaldiversity.org/accounts/Coccinella_septempunctata/',
      titleKey: 'sources.adwLadybirdTitle',
      supports: ['larval-stages-and-native-range'],
      access: 'official-page',
      checkedAt: '2026-10-01',
    },
    {
      id: 'holloway-1991-reflex-bleeding',
      url: 'https://link.springer.com/article/10.1007/BF01240660',
      titleKey: 'sources.bleedingTitle',
      supports: ['reflex-bleeding'],
      access: 'abstract',
      checkedAt: '2026-10-01',
    },
  ],
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
