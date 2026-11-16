import { Navigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { EmailSignIn } from '@/auth/EmailSignIn'
import { IS_CONFIGURED } from '@/lib/mode'
import { Brand, Button, Notice, Spinner } from '@/ui/kit'

export function Login() {
  const { state, signOut } = useAuth()
  if (state.status === 'signedIn') return <Navigate to={state.account.isAdmin ? '/admin' : '/portal'} replace />
  return (
    <main className="min-h-dvh bg-sand flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-bg border border-line p-6 md:p-8">
        <Brand />
        <h1 className="text-4xl mt-8 mb-2">Sign in</h1>
        {!IS_CONFIGURED ? (
          <div className="space-y-4">
            <Notice>Sign-in is not connected yet. The demo with sample data is available in the meantime.</Notice>
            <a className="underline" href="/demo/admin">Open the demo</a>
          </div>
        ) : state.status === 'loading' ? (
          <Spinner />
        ) : state.status === 'error' ? (
          <div className="space-y-4">
            <Notice tone="danger">We could not finish signing you in: {state.message}</Notice>
            <Button variant="outline" onClick={() => signOut()}>Start over</Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-muted">Enter your email and we will send you a sign-in link. No password needed.</p>
            <EmailSignIn redirectPath="/login" />
          </div>
        )}
      </div>
    </main>
  )
}
