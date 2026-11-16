import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IS_DEMO } from '@/lib/mode'
import { supabase } from '@/lib/supabase'
import { DEMO_ADMIN_EMAIL, DEMO_CLIENT_CONTACT_ID } from '@/data/demoSeed'

export type Account = { email: string; isAdmin: boolean; contactId: string | null }
type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; account: Account }
  | { status: 'error'; message: string }

type Auth = {
  state: AuthState
  /** Emails a sign-in link plus a 6-digit code. */
  sendLink(email: string, redirectPath?: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>
  /** Demo only: flip between the admin and the client point of view. */
  setDemoRole?(role: 'admin' | 'client'): void
}

const AuthContext = createContext<Auth | null>(null)
export const useAuth = () => {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

const DEMO_ACCOUNTS: Record<'admin' | 'client', Account> = {
  admin: { email: DEMO_ADMIN_EMAIL, isAdmin: true, contactId: null },
  client: { email: 'elena@harborlightdental.example', isAdmin: false, contactId: DEMO_CLIENT_CONTACT_ID },
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(
    IS_DEMO ? { status: 'signedIn', account: DEMO_ACCOUNTS.admin } : supabase ? { status: 'loading' } : { status: 'signedOut' },
  )

  // After any sign-in, ask the database who this is. The link to a CRM contact and the admin flag
  // are both decided in SQL from the verified email (see link_my_account in the migrations).
  const resolve = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('link_my_account')
    if (error) return setState({ status: 'error', message: error.message })
    setState({ status: 'signedIn', account: { email: data.email, isAdmin: data.is_admin, contactId: data.contact_id } })
  }, [])

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) return setState({ status: 'signedOut' })
      // Deferred: Supabase forbids calling its API from inside this callback.
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') setTimeout(resolve, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [resolve])

  const auth = useMemo<Auth>(
    () => ({
      state,
      async sendLink(email, redirectPath = '/login') {
        if (!supabase) throw new Error('Sign-in is not set up yet.')
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { emailRedirectTo: window.location.origin + redirectPath },
        })
        if (error) throw new Error(error.message)
      },
      async verifyCode(email, code) {
        if (!supabase) throw new Error('Sign-in is not set up yet.')
        const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
        if (error) throw new Error(error.message)
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut()
      },
      setDemoRole: IS_DEMO ? (role) => setState({ status: 'signedIn', account: DEMO_ACCOUNTS[role] }) : undefined,
    }),
    [state],
  )

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}
