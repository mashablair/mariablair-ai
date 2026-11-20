import { NavLink, Outlet } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { IS_DEMO } from '@/lib/mode'
import { DemoBar } from '@/ui/DemoBar'
import { Brand, cx } from '@/ui/kit'

// Add an entry here when a slice ships its screen.
export const ADMIN_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: 'Today', end: true },
  { to: '/admin/contacts', label: 'Contacts' },
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/events', label: 'Events' },
  { to: '/admin/sessions', label: 'Sessions' },
  { to: '/admin/intake', label: 'Intake forms' },
  { to: '/admin/materials', label: 'Materials' },
  { to: '/admin/billing', label: 'Billing' },
  { to: IS_DEMO ? '/admin/sync' : '/admin/sync/import', label: 'Sync from Google Sheet' },
]

export function AdminLayout() {
  const { state, signOut } = useAuth()
  const email = state.status === 'signedIn' ? state.account.email : ''
  const link = ({ isActive }: { isActive: boolean }) =>
    cx('block px-3 py-2 text-[13px] tracking-[0.14em] uppercase no-underline whitespace-nowrap', isActive ? 'text-ink bg-sand font-medium' : 'text-muted hover:text-ink')

  return (
    <div className="min-h-dvh flex flex-col">
      <DemoBar />
      <div className="flex-1 md:grid md:grid-cols-[220px_1fr]">
        <aside className="hidden md:flex flex-col border-r border-line p-5 gap-6 sticky top-0 h-dvh">
          <Brand to={IS_DEMO ? '/demo/admin' : '/'} />
          <nav aria-label="Admin" className="grid gap-1">
            {ADMIN_NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={link}>{n.label}</NavLink>)}
          </nav>
          <div className="mt-auto text-sm text-muted">
            <p className="truncate" title={email}>{email}</p>
            {!IS_DEMO && <button type="button" className="underline cursor-pointer" onClick={() => signOut()}>Sign out</button>}
          </div>
        </aside>

        <header className="md:hidden flex items-center justify-between border-b border-line px-4 py-3">
          <Brand to={IS_DEMO ? '/demo/admin' : '/'} />
          {!IS_DEMO && <button type="button" className="text-sm underline text-muted cursor-pointer" onClick={() => signOut()}>Sign out</button>}
        </header>

        <main className="px-4 py-6 md:px-10 md:py-10 pb-24 md:pb-10 min-w-0 max-w-6xl">
          <Outlet />
        </main>
      </div>

      {/* Phone: thumb-reachable tab bar (Maria adds contacts at networking events). */}
      <nav aria-label="Admin" className="md:hidden fixed bottom-0 inset-x-0 bg-bg border-t border-line flex overflow-x-auto pb-[env(safe-area-inset-bottom)]">
        {ADMIN_NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={(s) => cx(link(s), 'flex-1 text-center py-3')}>{n.label}</NavLink>)}
      </nav>
    </div>
  )
}
