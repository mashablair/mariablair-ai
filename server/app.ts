import { Hono } from 'hono'
import { handleAssessment } from './assessment'
import { handleCallRequest } from './callRequest'
import { realDeps, type Deps } from './deps'
import { handleStripeWebhook } from './stripe'
import { syncRoutes, type SyncApiDeps, realSyncDeps } from './sync/routes'

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
  CRM_SHEETS_SYNC_MODE?: string
  CRM_SHEETS_SYNC_ID?: string
  CRM_SHEETS_SYNC_ACCOUNT?: string
  CRM_SHEETS_SYNC_KEY?: string
}

export type AppContext = { Bindings: Env }

// The API is deliberately thin: only things the browser must not do live here.
// Written with Hono so it can move to a standalone Worker later without changes.
export function createApp(deps: Deps = realDeps, syncDeps: SyncApiDeps = realSyncDeps) {
  const app = new Hono<AppContext>().basePath('/api')

  // Says which integrations have their settings, without revealing any values.
  app.get('/health', (c) => {
    const env = c.env ?? ({} as Partial<Env>)
    return c.json({
      ok: true,
      configured: {
        database: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
        botCheck: Boolean(env.TURNSTILE_SECRET_KEY),
        stripe: Boolean(env.STRIPE_WEBHOOK_SECRET),
      },
    })
  })

  app.route('/sync', syncRoutes(syncDeps))

  app.post('/assessment', (c) => handleAssessment(c, deps))
  app.post('/call-request', (c) => handleCallRequest(c, deps))
  app.post('/stripe/webhook', (c) => handleStripeWebhook(c, deps))

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'server_error', message: 'Something went wrong on our side. Please try again.' }, 500)
  })
  return app
}

export const app = createApp()
