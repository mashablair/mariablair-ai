import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, Outlet } from 'react-router'
import { SESSION_TYPE_LABELS } from '@shared/types'
import { DownloadLink, MaterialMeta } from '@/admin/materials/MaterialsPage'
import { ResultsView } from '@/assessment/ResultsView'
import type { Account } from '@/auth/AuthProvider'
import { useAuth } from '@/auth/AuthProvider'
import { repo } from '@/data'
import { formatDate, formatDateTime } from '@/lib/format'
import { IS_DEMO } from '@/lib/mode'
import { DemoBar } from '@/ui/DemoBar'
import { Brand, Notice, Spinner } from '@/ui/kit'

export function PortalLayout() {
  const { signOut } = useAuth()
  return (
    <div className="min-h-dvh flex flex-col bg-sand">
      <DemoBar />
      <header className="bg-bg border-b border-line">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Brand to={IS_DEMO ? '/demo/portal' : '/'} />
          {!IS_DEMO && <button type="button" className="text-sm underline text-muted cursor-pointer" onClick={() => signOut()}>Sign out</button>}
        </div>
      </header>
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-3xl mb-3">{title}</h2>
      {children}
    </section>
  )
}

/** The client's read-only home: assessment results, shared next steps, materials, products, session summaries. */
export function PortalHome({ account }: { account: Account }) {
  const key = ['portal', account.email]
  const submissions = useQuery({ queryKey: [...key, 'submissions'], queryFn: () => repo().mySubmissions() })
  const recs = useQuery({ queryKey: [...key, 'recommendations'], queryFn: () => repo().myRecommendations() })
  const materials = useQuery({ queryKey: [...key, 'materials'], queryFn: () => repo().myMaterials() })
  const products = useQuery({ queryKey: [...key, 'products'], queryFn: () => repo().myProducts() })
  const sessions = useQuery({ queryKey: [...key, 'sessions'], queryFn: () => repo().mySessions() })
  const all = [submissions, recs, materials, products, sessions]
  const failed = all.find((q) => q.error)

  if (failed) return <Notice tone="danger">We could not load your account: {failed.error!.message}</Notice>
  if (all.some((q) => q.isPending)) return <Spinner />

  const [latest, ...earlier] = submissions.data!
  const summaries = sessions.data!.filter((s) => s.client_visible_summary).sort((a, b) => (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? ''))
  const empty = !latest && recs.data!.length + materials.data!.length + products.data!.length + summaries.length === 0

  return (
    <>
      <p className="label-caps mb-1">Your account</p>
      <h1 className="text-4xl mb-6">{latest ? 'Your AI assessment' : 'Welcome'}</h1>

      {empty && (
        <div className="grid gap-4">
          <Notice>There is nothing here for {account.email} yet. If you used a different email with Maria, sign in with that one.</Notice>
          <Link className="underline" to="/assessment">Take the free AI assessment</Link>
        </div>
      )}

      {latest && (
        <div className="grid gap-4">
          <p className="text-muted">Completed {formatDate(latest.created_at)}</p>
          <ResultsView data={{ track: latest.track, level: latest.level, recommendations: latest.recommendations, offerKey: latest.offer_key }} />
          {earlier.length > 0 && (
            <details>
              <summary className="cursor-pointer underline">Earlier results ({earlier.length})</summary>
              <div className="grid gap-6 mt-4">
                {earlier.map((s) => (
                  <div key={s.id}>
                    <p className="text-muted mb-2">Completed {formatDate(s.created_at)}</p>
                    <ResultsView data={{ track: s.track, level: s.level, recommendations: s.recommendations, offerKey: s.offer_key }} />
                  </div>
                ))}
              </div>
            </details>
          )}
          <p><Link className="underline" to="/assessment">Take the assessment again</Link></p>
        </div>
      )}

      {recs.data!.length > 0 && (
        <Block title="Recommendations from Maria">
          <ul className="list-none p-0 m-0 bg-bg border border-line">
            {recs.data!.map((r) => (
              <li key={r.id} className="p-4 border-b border-line last:border-0">
                <h3 className="!font-body font-medium text-lg">{r.title}</h3>
                {r.body && <p className="text-muted whitespace-pre-wrap">{r.body}</p>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {materials.data!.length > 0 && (
        <Block title="Your materials">
          <ul className="list-none p-0 m-0 bg-bg border border-line">
            {materials.data!.map((m) => (
              <li key={m.id} className="p-4 border-b border-line last:border-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="min-w-0"><span className="font-medium block">{m.title}</span><MaterialMeta material={m} /></span>
                <DownloadLink material={m} />
              </li>
            ))}
          </ul>
        </Block>
      )}

      {summaries.length > 0 && (
        <Block title="Session notes">
          <ul className="list-none p-0 m-0 bg-bg border border-line">
            {summaries.map((s) => (
              <li key={s.id} className="p-4 border-b border-line last:border-0">
                <h3 className="!font-body font-medium text-lg">{s.title ?? SESSION_TYPE_LABELS[s.type]}</h3>
                <p className="text-sm text-muted mb-1">{formatDateTime(s.scheduled_at)}</p>
                <p className="whitespace-pre-wrap">{s.client_visible_summary}</p>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {products.data!.length > 0 && (
        <Block title="Your products">
          <ul className="list-none p-0 m-0 bg-bg border border-line">
            {products.data!.map(({ entitlement, offer }) => (
              <li key={entitlement.id} className="p-4 border-b border-line last:border-0">
                <span className="font-medium block">{offer.name}</span>
                <span className="text-sm text-muted">{entitlement.source === 'purchase' ? 'Purchased' : 'Added by Maria'} {formatDate(entitlement.created_at)}{offer.description && ` · ${offer.description}`}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </>
  )
}
