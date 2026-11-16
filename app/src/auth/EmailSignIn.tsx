import { useState, type FormEvent } from 'react'
import { Button, Field, Input, Notice } from '@/ui/kit'
import { useAuth } from './AuthProvider'

/**
 * Passwordless sign-in in two steps: ask for the email, then accept the 6-digit code from the email
 * (the link in the same email also works, and brings the person back to `redirectPath`).
 */
export function EmailSignIn({ fixedEmail, redirectPath, sendLabel = 'Email me a link' }: { fixedEmail?: string; redirectPath: string; sendLabel?: string }) {
  const { sendLink, verifyCode } = useAuth()
  const [email, setEmail] = useState(fixedEmail ?? '')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  if (!sent) {
    return (
      <form className="grid gap-4" onSubmit={run(async () => { await sendLink(email, redirectPath); setSent(true) })}>
        {!fixedEmail && (
          <Field label="Email">
            <Input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Sending…' : sendLabel}</Button>
      </form>
    )
  }
  return (
    <form className="grid gap-4" onSubmit={run(() => verifyCode(email, code))}>
      <Notice tone="ok">Check {email}. Open the link in the email, or type the code from it here.</Notice>
      <Field label="Code from the email">
        <Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Checking…' : 'Sign in'}</Button>
      <Button variant="quiet" onClick={() => { setSent(false); setCode(''); setError(null) }}>{fixedEmail ? 'Send it again' : 'Use a different email'}</Button>
    </form>
  )
}
