import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext, Env } from '../app'
import { adminClient } from '../deps'
import { connectionKey } from './production'
import { realSyncDeps } from './routes'
import { SheetsSyncReadError } from '../googleSheetsSyncReader'
import { googleBootstrapEnabled, readGoogleBootstrap, googleSourceDigest, sealGooglePreview, openGooglePreview } from './googleBootstrap'

type BootstrapAction = 'preview' | 'apply'
export type BootstrapDeps = {
  adminUser: typeof realSyncDeps.adminUser
  enabled(env: Env): boolean
  googleEnabled?(env: Env): boolean
  readGoogle?: typeof readGoogleBootstrap
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
  googleEnabled: googleBootstrapEnabled,
  readGoogle: readGoogleBootstrap,
  async rpc(env, action, owner, args) {
    const actualKey = env.CRM_SHEETS_SYNC_ID ? await connectionKey(env.CRM_SHEETS_SYNC_ID) : undefined
    const key = env.CRM_SHEETS_BOOTSTRAP_CONNECTION ?? actualKey
    if (!key || (actualKey && key !== actualKey)) throw new Error('Import unavailable.')
    const { data, error } = await adminClient(env).rpc('crm_sheets_bootstrap', {
      p_connection: key,
      p_action: action, p_owner: owner, p_args: args,
    }).abortSignal(AbortSignal.timeout(10_000))
    if (error?.message === 'Bootstrap preview expired or blocked' || error?.message === 'Bootstrap preview expired') {
      throw new BootstrapRpcError('preview_expired_or_blocked')
    }
    if (error?.message === 'Bootstrap preview stale') throw new BootstrapRpcError('preview_stale')
    if (error?.message === 'Bootstrap blocked by active sync or recovery') throw new BootstrapRpcError('sync_busy')
    if (error || !data) throw new Error('Import unavailable.')
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
export const previewSchema = z.object({
  contacts: z.array(z.object({ id, name, source: safeText(1000), next_action: safeText(1000), follow_up_date: date }).strict()).min(1).max(200),
  tasks: z.array(z.object({ id, contact_id: id, title, due_date: date }).strict()).max(200),
}).strict().refine(({ contacts, tasks }) => {
  const ids = new Set(contacts.map(contact => contact.id))
  return contacts.length + tasks.length <= 200 && ids.size === contacts.length
    && new Set(tasks.map(t => t.id)).size === tasks.length
    && tasks.every(t => ids.has(t.contact_id))
})
// Keep legacy CSV acceptance unchanged; this extra ambiguity guard is Google-only.
const googlePreviewSchema = previewSchema.refine(({ tasks }) =>
  new Set(tasks.map(t => JSON.stringify([t.contact_id, t.title.trim().replace(/\s+/g, ' ').toLowerCase()]))).size === tasks.length)
const applySchema = z.object({ id: z.uuid() }).strict()
const disposition = z.enum(['create', 'linked', 'blocked'])
const googlePlanSchema = z.object({ canApply: z.boolean(), contacts: z.array(z.object({ id, name, disposition })),
  tasks: z.array(z.object({ id, title, contact_id: id, disposition })) })
const count = z.number().int().nonnegative()
const googleResultSchema = z.object({ contactsCreated: count, tasksCreated: count, contactsSkipped: count, tasksSkipped: count })
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
  routes.get('/status', c => c.json({ enabled: deps.enabled(c.env), googleEnabled: deps.googleEnabled?.(c.env) ?? false }))
  routes.post('/google/preview', async c => {
    if (!deps.googleEnabled?.(c.env) || !deps.readGoogle) return c.json({ error: 'import_disabled' }, 503)
    if (!z.object({}).strict().safeParse(await boundedJson(c.req.raw)).success) return c.json({ error: 'invalid_import' }, 400)
    let source: Awaited<ReturnType<typeof readGoogleBootstrap>>
    try { source = await deps.readGoogle(c.env) }
    catch (err) {
      if (err instanceof SheetsSyncReadError) {
        if (err.code === 'unauthorized') return c.json({ error: 'google_read_access' }, 409)
        if (err.code === 'unsupported_sheet') return c.json({ error: 'google_sheet_layout' }, 409)
        return c.json({ error: 'google_preview_unavailable' }, 409)
      }
      return c.json({ error: 'google_source_check_failed' }, 409)
    }
    const parsed = googlePreviewSchema.safeParse({ contacts: source.contacts, tasks: source.tasks })
    if (!parsed.success) return c.json({ error: 'invalid_google_import' }, 409)
    const id = crypto.randomUUID()
    let plan: z.infer<typeof googlePlanSchema>
    try {
      const reply = await deps.rpc(c.env, 'preview', c.get('bootstrapAdmin'), { id, ...parsed.data })
      plan = googlePlanSchema.parse(reply)
    } catch (err) {
      return c.json({ error: err instanceof BootstrapRpcError ? err.code : 'crm_preview_unavailable' }, 409)
    }
    try {
      // Opaque apply token: never disclose the database UUID to the browser.
      const token = await sealGooglePreview(c.env, c.get('bootstrapAdmin'), id, await googleSourceDigest(source))
      return c.json({ preview: { canApply: plan.canApply, contacts: plan.contacts, tasks: plan.tasks }, source, token })
    } catch { return c.json({ error: 'preview_ticket_unavailable' }, 409) }
  })
  routes.post('/google/apply', async c => {
    if (!deps.googleEnabled?.(c.env) || !deps.readGoogle) return c.json({ error: 'import_disabled' }, 503)
    const parsed = z.object({ token: z.string().min(1).max(2048) }).strict().safeParse(await boundedJson(c.req.raw))
    if (!parsed.success) return c.json({ error: 'invalid_import' }, 400)
    try {
      const ticket = await openGooglePreview(c.env, c.get('bootstrapAdmin'), parsed.data.token)
      if (ticket.expires <= Date.now()) return c.json({ error: 'preview_expired_or_blocked' }, 409)
      const source = await deps.readGoogle(c.env)
      if (await googleSourceDigest(source) !== ticket.digest) return c.json({ error: 'source_changed' }, 409)
      const reply = googleResultSchema.parse(await deps.rpc(c.env, 'apply', c.get('bootstrapAdmin'), { id: ticket.id }))
      return c.json({ contactsCreated: reply.contactsCreated, tasksCreated: reply.tasksCreated,
        contactsSkipped: reply.contactsSkipped, tasksSkipped: reply.tasksSkipped })
    } catch (err) { return c.json({ error: err instanceof BootstrapRpcError ? err.code : 'apply_unconfirmed' }, 409) }
  })
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
