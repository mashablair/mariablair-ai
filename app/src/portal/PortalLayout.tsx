import { useQuery } from '@tanstack/react-query'
import { Link, Outlet } from 'react-router'
import type { Account } from '@/auth/AuthProvider'
import { useAuth } from '@/auth/AuthProvider'
import { ResultsView } from '@/assessment/ResultsView'
import { repo } from '@/data'
import { formatDate } from '@/lib/format'
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

export function PortalHome({ account }: { account: Account }) {
  const submissions = useQuery({ queryKey: ['portal', 'submissions', account.email], queryFn: () => repo().mySubmissions() })
  const [latest, ...earlier] = submissions.data ?? []
  return (
    <>
      <p className="label-caps mb-1">Your account</p>
      <h1 className="text-4xl mb-6">Your AI assessment</h1>
      {submissions.isPending ? <Spinner /> : submissions.isError ? (
        <Notice tone="danger">We could not load your results: {submissions.error.message}</Notice>
      ) : !latest ? (
        <div className="grid gap-4">
          <Notice>There are no results for {account.email} yet. If you took the assessment with a different email, sign in with that one.</Notice>
          <Link className="underline" to="/assessment">Take the free assessment</Link>
        </div>
      ) : (
        <div className="grid gap-4">
          <p className="text-muted">Completed {formatDate(latest.created_at)}</p>
          <ResultsView data={{ track: latest.track, level: latest.level, recommendations: latest.recommendations, offerKey: latest.offer_key }} />
          {earlier.length > 0 && (
            <details className="mt-4">
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
    </>
  )
}
