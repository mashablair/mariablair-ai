import { COPY, LEVELS, OFFERS, type LevelKey, type OfferKey, type Track } from '@shared/assessment'

export type ResultsData = { track: Track; level: string; recommendations: { title: string; body: string }[]; offerKey: string | null; note?: string | null }

/** The results as the client sees them: level, three next steps, the matching offer. */
export function ResultsView({ data }: { data: ResultsData }) {
  const level = LEVELS.find((l) => l.key === (data.level as LevelKey))
  const offer = data.offerKey && data.offerKey in OFFERS ? OFFERS[data.offerKey as OfferKey] : null
  return (
    <div className="border border-line bg-bg">
      <div className="bg-deep text-on-deep p-6">
        <p className="label-caps !text-brass-on-deep mb-1">{COPY.results.levelLabel}</p>
        <p className="font-display text-4xl leading-tight mb-2">{level?.name ?? data.level}</p>
        {level && <p className="text-on-deep-muted">{level.summary[data.track]}</p>}
      </div>
      <div className="p-6">
        <h2 className="label-caps !font-body mb-2">{COPY.results.stepsTitle}</h2>
        <ol className="list-none p-0 m-0">
          {data.recommendations.map((r, i) => (
            <li key={i} className="grid grid-cols-[32px_1fr] gap-2 py-4 border-t border-line">
              <span className="font-display italic text-2xl text-brass leading-none pt-1">{i + 1}</span>
              <div>
                <h3 className="!font-body font-medium text-lg">{r.title}</h3>
                <p className="text-muted">{r.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {offer && (
          <div className="bg-sand border border-line p-5 mt-2">
            <p className="label-caps mb-1">{COPY.results.offerLabel}</p>
            <p className="font-display text-3xl leading-tight">{offer.name}</p>
            <p className="text-brass text-[15px] mb-2">{offer.price}</p>
            <p className="text-muted mb-4">{offer.body}</p>
            <a href={offer.url} target={offer.url.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
              className="inline-flex items-center min-h-11 px-5 bg-btn text-btn-ink border border-btn text-[13px] tracking-[0.14em] uppercase font-medium no-underline hover:bg-transparent hover:text-ink transition-colors">
              {offer.cta}
            </a>
          </div>
        )}
        {data.note && <p className="text-muted mt-4">{data.note}</p>}
      </div>
    </div>
  )
}
