import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app'
import { bootstrapEnabled, type BootstrapDeps } from '../server/sync/bootstrapRoutes'

const previewId = '00000000-0000-4000-8000-000000000001'
const owner = '00000000-0000-4000-8000-000000000002'
const baseEnv = { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-no-access' }
const contacts = [{ id: 'C-A', name: 'Fictional Person', source: 'Test workshop', next_action: 'Review draft', follow_up_date: '' }]
const tasks = [{ id: 'T-A', contact_id: 'C-A', title: 'Fictional follow-up', due_date: '2026-12-01' }]
const setup = (enabled = true) => {
  const rpc = vi.fn<BootstrapDeps['rpc']>(async (_env, action, _owner, args) => (
    action === 'preview' ? { ...args, canApply: true } : { id: previewId, contactsCreated: 1 }
  ))
  const app = createApp(undefined, undefined, {
    adminUser: async (_env, token) => token === 'admin' ? owner : null,
    enabled: () => enabled,
    rpc,
  })
  return {
    rpc,
    request: (p: string, token?: string, body?: object) => app.request('/api/sheets-bootstrap/' + p, {
      method: body ? 'POST' : 'GET',
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }, baseEnv),
  }
}

describe('first CSV import API boundaries', () => {
  it.each(['status', 'preview', 'apply'])('denies anonymous and non-admins for %s', async path => {
    const { request, rpc } = setup()
    const body = path === 'status' ? undefined : { id: previewId }
    expect((await request(path, undefined, body)).status).toBe(401)
    expect((await request(path, 'client', body)).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('does no import IO if disabled, even for a signed-in admin with a valid request', async () => {
    const { request, rpc } = setup(false)
    const status = await request('status', 'admin')
    expect(await status.json()).toEqual({ enabled: false, googleEnabled: false })
    expect(status.headers.get('Cache-Control')).toBe('no-store')
    expect((await request('preview', 'admin', { contacts, tasks })).status).toBe(503)
    expect((await request('apply', 'admin', { id: previewId })).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('requires independent explicit enable and verified server-side connection pin, with live sync off', () => {
    const pin = 'a'.repeat(64)
    const cfg = { ...baseEnv, CRM_SHEETS_BOOTSTRAP_ENABLED: '1', CRM_SHEETS_BOOTSTRAP_CONNECTION: pin }
    expect(bootstrapEnabled(baseEnv)).toBe(false)
    expect(bootstrapEnabled({ ...cfg, CRM_SHEETS_SYNC_MODE: 'preview' })).toBe(false)
    expect(bootstrapEnabled({ ...cfg, CRM_SHEETS_BOOTSTRAP_CONNECTION: 'invalid' })).toBe(false)
    expect(bootstrapEnabled(cfg)).toBe(true)
  })
  it('passes only strict prepared fields and the server-minted preview UUID bound to the verified user', async () => {
    const { request, rpc } = setup()
    expect((await request('preview', 'admin', { contacts, tasks })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(baseEnv, 'preview', owner, { id: expect.stringMatching(/^[a-f0-9-]{36}$/), contacts, tasks })
    expect((await request('apply', 'admin', { id: previewId })).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(baseEnv, 'apply', owner, { id: previewId })
  })
  it('rejects private fields, arbitrary destinations and payload substitution', async () => {
    const { request, rpc } = setup()
    expect((await request('preview', 'admin', { contacts: [{ ...contacts[0], note: 'internal text' }], tasks })).status).toBe(400)
    expect((await request('preview', 'admin', { contacts, tasks, spreadsheetId: 'arbitrary' })).status).toBe(400)
    expect((await request('preview', 'admin', { contacts, tasks: [{ ...tasks[0], contact_id: 'C-Missing' }] })).status).toBe(400)
    expect((await request('preview', 'admin', { contacts: [...contacts, ...contacts], tasks })).status).toBe(400)
    expect((await request('apply', 'admin', { id: previewId, contacts, tasks })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('redacts remote failures in authenticated responses', async () => {
    const { request, rpc } = setup()
    rpc.mockRejectedValue(new Error('unexpected internal text'))
    const r = await request('apply', 'admin', { id: previewId })
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'apply_unconfirmed' })
  })
})
