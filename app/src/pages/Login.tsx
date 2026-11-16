import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { IS_CONFIGURED } from '@/lib/mode'
import { Brand, Button, Field, Input, Notice, Spinner } from '@/ui/kit'

export function Login() {
  const { state, sendLink, verifyCode, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'signedIn') return <Navigate to={state.account.isAdmin ? '/admin' : '/portal'} replace />

  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

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
        ) : !sent ? (
          <form className="space-y-4" onSubmit={run(async () => { await sendLink(email); setSent(true) })}>
            <p className="text-muted">Enter your email and we will send you a sign-in link. No password needed.</p>
            <Field label="Email">
              <Input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Sending…' : 'Email me a link'}</Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={run(() => verifyCode(email, code))}>
            <Notice tone="ok">Check {email}. Open the link in the email, or type the code from it here.</Notice>
            <Field label="Code from the email">
              <Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" required value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Checking…' : 'Sign in'}</Button>
            <Button variant="quiet" onClick={() => { setSent(false); setCode(''); setError(null) }}>Use a different email</Button>
          </form>
        )}
      </div>
    </main>
  )
}
