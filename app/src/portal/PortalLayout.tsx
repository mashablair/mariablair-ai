import { Outlet } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { IS_DEMO } from '@/lib/mode'
import { DemoBar } from '@/ui/DemoBar'
import { Brand } from '@/ui/kit'

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

export function PortalHome() {
  return (
    <>
      <p className="label-caps mb-1">Your account</p>
      <h1 className="text-4xl mb-4">Welcome</h1>
      <p className="text-muted">Your assessment results and shared materials will appear here.</p>
    </>
  )
}
