import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext, Env } from '../app'
import { adminClient } from '../deps'
import { SyncCoordinator, SyncError } from './coordinator'
import { productionCoordinator, productionSyncMode, type ProductionSyncMode } from './production'

export interface SyncApiDeps {
  adminUser(env: Env, token: string): Promise<string | null>
  coordinator(env: Env): SyncCoordinator | null
  mode?(env: Env): ProductionSyncMode
}
export const realSyncDeps: SyncApiDeps = {
  async adminUser(env, token) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
    const db = adminClient(env)
    const { data, error } = await db.auth.getUser(token)
    if (error || !data.user) return null
    const result = await db.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle()
    return !result.error && result.data ? data.user.id : null
  },
  coordinator: productionCoordinator,
  mode: productionSyncMode,
}
const requestSchema = z.object({
  previewId: z.uuid(),
  choices: z.record(z.string().max(200), z.enum(['sheet', 'app'])).default({}),
}).strict()
export function syncRoutes(deps: SyncApiDeps = realSyncDeps) {
  const routes = new Hono<AppContext & { Variables: { syncUser: string } }>()
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const authorization = c.req.header('Authorization') ?? ''
    const match = /^Bearer ([^\s]+)$/.exec(authorization)
    if (!match) return c.json({ error: 'unauthorized' }, 401)
    let user: string | null = null
    try { user = await deps.adminUser(c.env, match[1]!) } catch { return c.json({ error: 'authorization_unavailable' }, 503) }
    if (!user) return c.json({ error: 'forbidden' }, 403)
    c.set('syncUser', user)
    await next()
  })
  const mode = (env: Env, coordinator: SyncCoordinator | null): ProductionSyncMode =>
    !coordinator ? 'off' : deps.mode?.(env) ?? 'sheet_to_app'
  routes.get('/status', async c => {
    const coordinator = deps.coordinator(c.env)
    const currentMode = mode(c.env, coordinator)
    return c.json({ configured: currentMode !== 'off', scope: ['Contacts', 'Follow-ups'],
      mode: currentMode, liveWritesEnabled: currentMode === 'sheet_to_app', googleWritesEnabled: false })
  })
  routes.get('/pending', async c => {
    const coordinator = deps.coordinator(c.env)
    if (!coordinator || mode(c.env, coordinator) !== 'sheet_to_app') return c.json({ previewId: null })
    try { return c.json({ previewId: await coordinator.pendingFor(c.get('syncUser')) }) }
    catch { return c.json({ error: 'sync_status_unavailable' }, 503) }
  })
  routes.post('/preview', async c => {
    const coordinator = deps.coordinator(c.env)
    if (!coordinator) return c.json({ error: 'sync_not_configured', message: 'Live Google Sheets sync is not connected. The demo uses sample data only.' }, 503)
    try { return c.json(await coordinator.preview(c.get('syncUser'))) }
    catch (err) {
      if (err instanceof SyncError) return c.json({ error: err.code, message: err.message }, 409)
      return c.json({ error: 'preview_failed', message: 'Could not safely prepare a preview. Check the connection, linking and database setup. No CRM or Sheet records were changed.' }, 409)
    }
  })
  routes.post('/apply', async c => {
    if (Number(c.req.header('Content-Length') ?? 0) > 64_000) return c.json({ error: 'request_too_large' }, 413)
    const reader = c.req.raw.body?.getReader()
    const decoder = new TextDecoder()
    let raw = '', size = 0
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 64_000) { await reader.cancel(); return c.json({ error: 'request_too_large' }, 413) }
          raw += decoder.decode(chunk.value, { stream: true })
        }
        raw += decoder.decode()
      } catch { return c.json({ error: 'invalid_request' }, 400) }
      finally { reader.releaseLock() }
    }
    let parsed: ReturnType<typeof requestSchema.safeParse>
    try { parsed = requestSchema.safeParse(JSON.parse(raw)) } catch { return c.json({ error: 'invalid_request' }, 400) }
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)
    const coordinator = deps.coordinator(c.env)
    if (!coordinator || mode(c.env, coordinator) !== 'sheet_to_app') return c.json({ error: 'sync_not_configured', message: 'Applying changes is disabled.' }, 503)
    try { return c.json(await coordinator.apply(c.get('syncUser'), parsed.data.previewId, parsed.data.choices)) }
    catch (err) {
      if (err instanceof SyncError) return c.json({ error: err.code, message: err.message }, 409)
      // Do not expose remote response bodies, notes, tokens or request payloads in logs/errors.
      return c.json({ error: 'sync_failed', message: 'Sync did not complete. Review its status before trying again.' }, 409)
    }
  })
  return routes
}
