import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { Button, Notice, Spinner } from '@/ui/kit'
import { useAuth, type Account } from './AuthProvider'

/** UI convenience only. The real protection is Row Level Security in the database. */
export function RequireAccount({ admin = false, children }: { admin?: boolean; children: (account: Account) => ReactNode }) {
  const { state, signOut } = useAuth()
  if (state.status === 'loading') return <Spinner />
  if (state.status === 'signedOut') return <Navigate to="/login" replace />
  if (state.status === 'error') {
    return (
      <div className="p-6 space-y-4 max-w-lg">
        <Notice tone="danger">We could not load your account: {state.message}</Notice>
        <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
      </div>
    )
  }
  if (admin && !state.account.isAdmin) return <Navigate to="/portal" replace />
  return <>{children(state.account)}</>
}
