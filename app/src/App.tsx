import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AdminLayout } from '@/admin/AdminLayout'
import { Dashboard } from '@/admin/Dashboard'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAccount } from '@/auth/guards'
import { IS_DEMO, ROUTER_BASENAME } from '@/lib/mode'
import { Login } from '@/pages/Login'
import { PortalHome, PortalLayout } from '@/portal/PortalLayout'
import { Brand } from '@/ui/kit'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })

function NotFound() {
  return (
    <main className="min-h-dvh bg-sand flex items-center justify-center p-4">
      <div className="bg-bg border border-line p-8 max-w-md">
        <Brand />
        <h1 className="text-4xl mt-6 mb-2">Page not found</h1>
        <p className="text-muted mb-4">That page does not exist.</p>
        <a className="underline" href="/">Back to the home page</a>
      </div>
    </main>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename={ROUTER_BASENAME}>
          <Routes>
            {IS_DEMO && <Route index element={<Navigate to="/admin" replace />} />}
            <Route path="/login" element={<Login />} />
            <Route path="/admin" element={<RequireAccount admin>{() => <AdminLayout />}</RequireAccount>}>
              <Route index element={<Dashboard />} />
            </Route>
            <Route path="/portal" element={<RequireAccount>{() => <PortalLayout />}</RequireAccount>}>
              <Route index element={<PortalHome />} />
            </Route>
            <Route path="/app/*" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
