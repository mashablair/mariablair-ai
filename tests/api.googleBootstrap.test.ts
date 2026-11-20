import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app'
import type { BootstrapDeps } from '../server/sync/bootstrapRoutes'
import { SheetsSyncReadError } from '../server/googleSheetsSyncReader'
import { fictionalSource } from './fixtures/googleBootstrap'
const owner = '00000000-0000-4000-8000-000000000001'
const env = { SUPABASE_URL: 'https://fictional.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-key', CRM_SHEETS_SYNC_ID: 'fictional_workbook' }
function setup(enabled = true) {
  const readGoogle = vi.fn(async () => fictionalSource())
  const rpc = vi.fn<BootstrapDeps['rpc']>(async (_env, action, _owner, args) => action === 'preview'
    ? { ...args, canApply: true, contacts: fictionalSource().contacts.map(c => ({ ...c, disposition: 'create' })), tasks: fictionalSource().tasks.map(t => ({ ...t, disposition: 'create' })) }
    : { ...args, contactsCreated: 1, tasksCreated: 1, contactsSkipped: 0, tasksSkipped: 0 })
  const app = createApp(undefined, undefined, { enabled: () => true, googleEnabled: () => enabled,
    adminUser: async (_env, token) => token === 'admin' ? owner : token === 'other-admin' ? 'other' : null, readGoogle, rpc })
  return { readGoogle, rpc, request: (path: string, body: object, token = 'admin') => app.request('/api/sheets-bootstrap/' + path,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env) }
}
describe('direct Google first import API', () => {
  it.each(['google/preview', 'google/apply'])('denies nonadmins and disabled access before IO: %s', async path => {
    const s = setup()
    expect((await s.request(path, {}, 'client')).status).toBe(403)
    expect((await s.request(path, {}, '')).status).toBe(401)
    expect(s.readGoogle).not.toHaveBeenCalled(); expect(s.rpc).not.toHaveBeenCalled()
    const disabled = setup(false)
    expect((await disabled.request(path, {})).status).toBe(503)
    expect(disabled.readGoogle).not.toHaveBeenCalled(); expect(disabled.rpc).not.toHaveBeenCalled()
  })
  it('previews, rereads on confirm, applies only the stored UUID, and hides that UUID in responses', async () => {
    const s = setup()
    const response = await s.request('google/preview', {})
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const preview = await response.json()
    const args = s.rpc.mock.calls[0]![3] as { id: string }
    expect(preview).toMatchObject({ source: fictionalSource(), preview: { canApply: true }, token: expect.any(String) })
    expect(JSON.stringify(preview)).not.toContain(args.id)
    const applied = await s.request('google/apply', { token: preview.token })
    expect(await applied.json()).toEqual({ contactsCreated: 1, tasksCreated: 1, contactsSkipped: 0, tasksSkipped: 0 })
    expect(s.readGoogle).toHaveBeenCalledTimes(2)
    expect(s.rpc).toHaveBeenLastCalledWith(env, 'apply', owner, { id: args.id })
  })
  it('rejects changed Google values before apply, including changes on either tab', async () => {
    for (const group of ['contacts', 'tasks'] as const) {
      const s = setup(); const preview = await (await s.request('google/preview', {})).json()
      const changed = fictionalSource()
      if (group === 'contacts') changed.contacts[0]!.next_action = 'Changed'
      else changed.tasks[0]!.title = 'Changed'
      s.readGoogle.mockResolvedValue(changed)
      expect(await (await s.request('google/apply', { token: preview.token })).json()).toEqual({ error: 'source_changed' })
      expect(s.rpc).toHaveBeenCalledTimes(1)
    }
  })
  it('rejects token substitution, other owners and caller-selected workbooks', async () => {
    const s = setup(); const preview = await (await s.request('google/preview', {})).json()
    expect((await s.request('google/preview', { spreadsheetId: 'other' })).status).toBe(400)
    expect((await s.request('google/apply', { token: preview.token, contacts: [] })).status).toBe(400)
    expect((await s.request('google/apply', { token: preview.token }, 'other-admin')).status).toBe(409)
    expect((await s.request('apply', { id: preview.token })).status).toBe(400)
    expect(s.readGoogle).toHaveBeenCalledTimes(1); expect(s.rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['duplicate-contact', 'duplicate-task', 'duplicate-action', 'date', 'orphan', 'missing-id'])('blocks %s before persisting a preview', async scenario => {
    const s = setup(); const source = fictionalSource()
    if (scenario === 'duplicate-contact') source.contacts.push(source.contacts[0]!)
    if (scenario === 'duplicate-task') source.tasks.push(source.tasks[0]!)
    if (scenario === 'duplicate-action') source.tasks.push({ ...source.tasks[0]!, id: 'T-2', title: '  EXAMPLE   follow-up ' })
    if (scenario === 'date') source.contacts[0]!.follow_up_date = '2027-02-29'
    if (scenario === 'orphan') source.tasks[0]!.contact_id = 'C-missing'
    if (scenario === 'missing-id') source.contacts[0]!.id = ''
    s.readGoogle.mockResolvedValue(source)
    expect((await s.request('google/preview', {})).status).toBe(409)
    expect(s.rpc).not.toHaveBeenCalled()
  })
  it('redacts failures without logging private Google contents and prevents writes on reread failure', async () => {
    const s = setup(); const log = vi.spyOn(console, 'error')
    const preview = await (await s.request('google/preview', {})).json()
    s.readGoogle.mockRejectedValue(new Error('PRIVATE_PROVIDER_CONTENT'))
    expect(await (await s.request('google/apply', { token: preview.token })).json()).toEqual({ error: 'apply_unconfirmed' })
    expect(await (await s.request('google/preview', {})).json()).toEqual({ error: 'google_source_check_failed' })
    expect(s.rpc).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled(); log.mockRestore()
  })
  it('reports a safe stage for Google access and CRM preview failures', async () => {
    const s = setup()
    s.readGoogle.mockRejectedValueOnce(new SheetsSyncReadError('unauthorized'))
    expect(await (await s.request('google/preview', {})).json()).toEqual({ error: 'google_read_access' })
    expect(s.rpc).not.toHaveBeenCalled()
    s.rpc.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_ERROR'))
    expect(await (await s.request('google/preview', {})).json()).toEqual({ error: 'crm_preview_unavailable' })
  })
  it('rejects expired tickets before Google or database IO', async () => {
    const s = setup(); const preview = await (await s.request('google/preview', {})).json()
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    try { expect(await (await s.request('google/apply', { token: preview.token })).json()).toEqual({ error: 'preview_expired_or_blocked' }) }
    finally { now.mockRestore() }
    expect(s.readGoogle).toHaveBeenCalledTimes(1); expect(s.rpc).toHaveBeenCalledTimes(1)
  })
})
