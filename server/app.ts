import { Hono } from 'hono'

// Secrets and settings provided by Cloudflare (Pages secrets in production, .dev.vars locally).
export type Env = {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  ADMIN_NOTIFY_EMAIL?: string
  TURNSTILE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  PUBLIC_SITE_URL?: string
}

export type AppContext = { Bindings: Env }

// The API is deliberately thin: only things the browser must not do live here.
// Written with Hono so it can move to a standalone Worker later without changes.
export const app = new Hono<AppContext>().basePath('/api')

app.get('/health', (c) => c.json({ ok: true }))

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'server_error' }, 500)
})
