import { useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { IS_DEMO } from '@/lib/mode'

/** Shown on every demo screen: says the data is fictional and lets visitors switch point of view. */
export function DemoBar() {
  const { state, setDemoRole } = useAuth()
  const navigate = useNavigate()
  if (!IS_DEMO || !setDemoRole || state.status !== 'signedIn') return null
  const isAdmin = state.account.isAdmin
  const go = (role: 'admin' | 'client') => {
    setDemoRole(role)
    navigate(role === 'admin' ? '/admin' : '/portal')
  }
  return (
    <div className="bg-deep text-on-deep text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      <span><b className="font-medium text-brass-on-deep">Demo.</b> Sample people and companies. Changes reset when you reload.</span>
      <span className="flex gap-3">
        <button type="button" aria-pressed={isAdmin} onClick={() => go('admin')} className="underline aria-pressed:no-underline aria-pressed:font-medium cursor-pointer">Consultant view</button>
        <button type="button" aria-pressed={!isAdmin} onClick={() => go('client')} className="underline aria-pressed:no-underline aria-pressed:font-medium cursor-pointer">Client view</button>
      </span>
    </div>
  )
}
