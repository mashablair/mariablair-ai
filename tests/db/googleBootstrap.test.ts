import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './harness'
import { createApp } from '../../server/app'
import { connectionKey } from '../../server/sync/production'
import { projectGoogleBootstrap } from '../../server/sync/googleBootstrap'
import { fictionalSnapshot } from '../fixtures/googleBootstrap'

const owner = '00000000-0000-4000-8000-000000000001'
const env = { SUPABASE_URL: 'https://fictional.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional', CRM_SHEETS_SYNC_ID: 'fictional_workbook' }
describe('Google preview to existing bootstrap transaction', () => {
  let db: PGlite
  let snapshot = fictionalSnapshot()
  let key: string
  beforeAll(async () => {
    db = await createDb(); key = await connectionKey(env.CRM_SHEETS_SYNC_ID)
    await db.query('insert into public.crm_sheets_sync_connection(connection_key) values ($1)', [key])
    await db.query("insert into auth.users(id,email) values ($1,'example@example.invalid')", [owner])
    await db.query("insert into public.admins(user_id,email) values ($1,'example@example.invalid')", [owner])
  })
  beforeEach(async () => {
    snapshot = fictionalSnapshot()
    await db.exec('truncate public.crm_sheets_bootstrap_previews, public.crm_sheets_sync_receipts, public.crm_sheets_sync_links; truncate public.contacts cascade')
  })
  afterAll(async () => { await db?.close() })
  const app = createApp(undefined, undefined, { enabled: () => false, googleEnabled: () => true,
    adminUser: async (_env, token) => token === 'admin' ? owner : null,
    readGoogle: async () => projectGoogleBootstrap(snapshot),
    rpc: async (_env, action, user, args) => db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return (await tx.query<{result: unknown}>('select public.crm_sheets_bootstrap($1,$2,$3,$4::jsonb) as result', [key, action, user, JSON.stringify(args)])).rows[0]!.result
    }) })
  const request = (action: string, body: object) => app.request('/api/sheets-bootstrap/google/' + action,
    { method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)
  async function preview() { const res = await request('preview', {}); expect(res.status).toBe(200); return res.json() }
  it('creates both tabs, preserves links, replays once, and separates overlapping linked edits from a new task', async () => {
    const first = await preview()
    expect((await db.query('select * from public.contacts')).rows).toHaveLength(0)
    const imported = { contactsCreated: 1, tasksCreated: 1, contactsSkipped: 0, tasksSkipped: 0 }
    expect(await (await request('apply', { token: first.token })).json()).toEqual(imported)
    expect(await (await request('apply', { token: first.token })).json()).toEqual(imported)
    const links = (await db.query('select kind, external_id, app_id from public.crm_sheets_sync_links order by kind')).rows
    await db.exec("update public.contacts set next_action='CRM edit'; update public.tasks set title='CRM task edit'")
    snapshot.tabs[0]!.rows[1]!.cells[3]!.value = 'New Sheet edit'
    const task = structuredClone(snapshot.tabs[1]!.rows[1]!)
    task.row = 3; task.cells[0]!.value = 'T-2'; task.cells[2]!.value = 'Another example task'
    snapshot.tabs[1]!.rows.push(task)
    const mixed = await preview()
    expect(mixed.preview.contacts[0].disposition).toBe('linked')
    expect(mixed.preview.tasks.map((t: {disposition: string}) => t.disposition)).toEqual(['linked', 'create'])
    expect(await (await request('apply', { token: mixed.token })).json()).toEqual({ contactsCreated: 0, tasksCreated: 1, contactsSkipped: 1, tasksSkipped: 1 })
    expect((await db.query('select next_action from public.contacts')).rows).toEqual([{ next_action: 'CRM edit' }])
    expect((await db.query("select title from public.tasks where title='CRM task edit'")).rows).toHaveLength(1)
    expect((await db.query("select kind, external_id, app_id from public.crm_sheets_sync_links where external_id in ('C-1','T-1') order by kind")).rows).toEqual(links)
  })
  it('blocks overlap by name and rejects a CRM duplicate created after preview', async () => {
    const first = await preview()
    await db.exec("insert into public.contacts(first_name,last_name) values ('FICTIONAL','Person')")
    expect((await request('apply', { token: first.token })).status).toBe(409)
    const blocked = await preview()
    expect(blocked.preview.canApply).toBe(false)
    expect(blocked.preview.contacts[0].disposition).toBe('blocked')
    expect((await request('apply', { token: blocked.token })).status).toBe(409)
    expect((await db.query('select * from public.tasks')).rows).toHaveLength(0)
  })
  it('rejects a source edit without any CRM writes', async () => {
    const first = await preview()
    snapshot.tabs[1]!.rows[1]!.cells[2]!.value = 'Changed after preview'
    expect(await (await request('apply', { token: first.token })).json()).toEqual({ error: 'source_changed' })
    expect((await db.query('select * from public.contacts')).rows).toHaveLength(0)
    expect((await db.query('select * from public.crm_sheets_sync_links')).rows).toHaveLength(0)
  })
})
