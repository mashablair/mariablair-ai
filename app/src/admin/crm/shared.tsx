import type { ReactNode } from 'react'
import { STAGE_LABELS, type Stage } from '@shared/types'
import { Badge, Notice, Spinner } from '@/ui/kit'

const STAGE_TONES: Record<Stage, 'neutral' | 'brass' | 'ok' | 'danger'> = {
  new: 'neutral', contacted: 'neutral', assessment_completed: 'brass', consultation: 'brass', active_client: 'ok', past_client: 'neutral', not_a_fit: 'danger',
}
export const StageBadge = ({ stage }: { stage: Stage }) => <Badge tone={STAGE_TONES[stage]}>{STAGE_LABELS[stage]}</Badge>

type Q<T> = { isPending: boolean; error: Error | null; data: T | undefined }
/** Renders loading and error states for one or more queries, then the content. */
export function Loaded({ queries, children }: { queries: Q<unknown>[]; children: () => ReactNode }) {
  const failed = queries.find((q) => q.error)
  if (failed) return <Notice tone="danger">Could not load data: {failed.error!.message}</Notice>
  if (queries.some((q) => q.isPending)) return <Spinner />
  return <>{children()}</>
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-2 mb-3">
        <h2 className="text-2xl">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** A definition-list row that hides itself when there is nothing to show. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1.5">
      <dt className="text-muted text-[15px]">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </div>
  )
}
