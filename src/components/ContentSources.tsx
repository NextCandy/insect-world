import { useId } from 'react'
import { CONTENT_SOURCES, type ContentClaim } from '../data/contentSources'
import { useT } from '../i18n/useT'
import s from './ContentSources.module.css'

const claimKeys = {
  'japanese-subspecies-length': 'sources.length',
  'diet-and-range': 'sources.dietRange',
  'male-combat': 'sources.combat',
} as const satisfies Record<ContentClaim, string>

export function ContentSources({ insectId }: { insectId: string }) {
  const t = useT()
  const headingId = useId()
  const sources = CONTENT_SOURCES[insectId]
  return (
    <section className={s.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.title}>{t('sources.title')}</h2>
      {sources?.length ? (
        <>
          <p className={s.notice}>{t('sources.limits')}</p>
          <ul className={s.list}>
            {sources.map(source => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{t(source.titleKey)}</a>
                <p className={s.scope}>
                  {t('sources.supports', { facts: source.supports.map(claim => t(claimKeys[claim])).join(t('sources.separator')) })}
                </p>
                <p className={s.checked}>
                  {t(source.access === 'full-text' ? 'sources.fullText' : 'sources.officialPage')}
                  {' · '}{t('sources.checkedAt', { date: source.checkedAt })}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : <p className={s.notice}>{t('sources.pending')}</p>}
    </section>
  )
}
