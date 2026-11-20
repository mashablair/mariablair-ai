import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext, Env } from '../app'
import { adminClient } from '../deps'
import { connectionKey } from './production'
import { realSyncDeps } from './routes'

type BootstrapAction = 'preview' | 'apply'
export type BootstrapDeps = {
  adminUser: typeof realSyncDeps.adminUser
  enabled(env: Env): boolean
  rpc(env: Env, action: BootstrapAction, owner: string, args: object): Promise<unknown>
}

export const bootstrapEnabled = (env: Env) => Boolean(env.CRM_SHEETS_BOOTSTRAP_ENABLED === '1'
  && (!env.CRM_SHEETS_SYNC_MODE || env.CRM_SHEETS_SYNC_MODE === 'off')
  && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  && (/^[a-f0-9]{64}$/.test(env.CRM_SHEETS_BOOTSTRAP_CONNECTION ?? '')
    || (!env.CRM_SHEETS_BOOTSTRAP_CONNECTION && /^[A-Za-z0-9_-]{10,200}$/.test(env.CRM_SHEETS_SYNC_ID ?? ''))))

class BootstrapRpcError extends Error {
  constructor(readonly code: 'preview_expired_or_blocked' | 'preview_stale' | 'sync_busy') { super(code) }
}
const realBootstrapDeps: BootstrapDeps = {
  adminUser: realSyncDeps.adminUser,
  enabled: bootstrapEnabled,
  async rpc(env, action, owner, args) {
    const actualKey = env.CRM_SHEETS_SYNC_ID ? await connectionKey(env.CRM_SHEETS_SYNC_ID) : undefined
    const key = env.CRM_SHEETS_BOOTSTRAP_CONNECTION ?? actualKey
    if (!key || (actualKey && key !== actualKey)) throw new Error('CSV import unavailable.')
    const { data, error } = await adminClient(env).rpc('crm_sheets_bootstrap', {
      p_connection: key,
      p_action: action, p_owner: owner, p_args: args,
    }).abortSignal(AbortSignal.timeout(10_000))
    if (error?.message === 'Bootstrap preview expired or blocked' || error?.message === 'Bootstrap preview expired') {
      throw new BootstrapRpcError('preview_expired_or_blocked')
    }
    if (error?.message === 'Bootstrap preview stale') throw new BootstrapRpcError('preview_stale')
    if (error?.message === 'Bootstrap blocked by active sync or recovery') throw new BootstrapRpcError('sync_busy')
    if (error || !data) throw new Error('CSV import unavailable.')
    return data
  },
}
const safeText = (max: number) => z.string().max(max).refine(v => !v.includes('\0'))
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
const date = z.string().refine(value => {
  if (!value) return true
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})
const name = safeText(200).refine(x => !!x && x === x.trim() && !/[\x00-\x1f]/.test(x))
const title = safeText(1000).refine(x => !!x.trim())
const previewSchema = z.object({
  contacts: z.array(z.object({ id, name, source: safeText(1000), next_action: safeText(1000), follow_up_date: date }).strict()).min(1).max(200),
  tasks: z.array(z.object({ id, contact_id: id, title, due_date: date }).strict()).max(200),
}).strict().refine(({ contacts, tasks }) => {
  const ids = new Set(contacts.map(contact => contact.id))
  return contacts.length + tasks.length <= 200 && ids.size === contacts.length
    && new Set(tasks.map(t => t.id)).size === tasks.length && tasks.every(t => ids.has(t.contact_id))
})
const applySchema = z.object({ id: z.uuid() }).strict()
const BODY_LIMIT = 256_000
async function boundedJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('Content-Length')) > BODY_LIMIT) return null
  const reader = req.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let raw = '', size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > BODY_LIMIT) { await reader.cancel(); return null }
      raw += decoder.decode(next.value, { stream: true })
    }
    return JSON.parse(raw + decoder.decode())
  } catch { return null }
  finally { reader.releaseLock() }
}

export function bootstrapRoutes(deps: BootstrapDeps = realBootstrapDeps) {
  const routes = new Hono<AppContext & { Variables: { bootstrapAdmin: string } }>()
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const match = /^Bearer ([^\s]+)$/.exec(c.req.header('Authorization') ?? '')
    if (!match) return c.json({ error: 'unauthorized' }, 401)
    let owner: string | null
    try { owner = await deps.adminUser(c.env, match[1]!) }
    catch { return c.json({ error: 'authorization_unavailable' }, 503) }
    if (!owner) return c.json({ error: 'forbidden' }, 403)
    c.set('bootstrapAdmin', owner)
    await next()
  })
  routes.get('/status', c => c.json({ enabled: deps.enabled(c.env) }))
  routes.post('/preview', async c => {
    if (!deps.enabled(c.env)) return c.json({ error: 'import_disabled' }, 503)
    const parsed = previewSchema.safeParse(await boundedJson(c.req.raw))
    if (!parsed.success) return c.json({ error: 'invalid_import' }, 400)
    try {
      return c.json(await deps.rpc(c.env, 'preview', c.get('bootstrapAdmin'), { id: crypto.randomUUID(), ...parsed.data }) as {})
    } catch (err) { return c.json({ error: err instanceof BootstrapRpcError ? err.code : 'preview_unavailable' }, 409) }
  })
  routes.post('/apply', async c => {
    if (!deps.enabled(c.env)) return c.json({ error: 'import_disabled' }, 503)
    const parsed = applySchema.safeParse(await boundedJson(c.req.raw))
    if (!parsed.success) return c.json({ error: 'invalid_import' }, 400)
    try {
      return c.json(await deps.rpc(c.env, 'apply', c.get('bootstrapAdmin'), parsed.data) as {})
    } catch (err) { return c.json({ error: err instanceof BootstrapRpcError ? err.code : 'apply_unconfirmed' }, 409) }
  })
  return routes
}
