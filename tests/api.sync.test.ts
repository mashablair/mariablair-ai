import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app'
import { productionCoordinator, productionSyncMode } from '../server/sync/production'
import { SyncCoordinator, type SyncStore } from '../server/sync/coordinator'
import type { SyncApiDeps } from '../server/sync/routes'
const uuid = '00000000-0000-4000-8000-000000000101'
const env = { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }
const deps: SyncApiDeps = { adminUser: async (_e, token) => token === 'admin' ? 'owner' : null, coordinator: () => null }
const app = createApp(undefined, deps)
const req = (path: string, token?: string, method = 'POST', body?: object) => app.request(`/api/sync/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env)
describe('sync API boundaries', () => {
  it.each(['preview', 'apply', 'status', 'pending'])('rejects anonymous and clients for %s', async path => {
    const method = (path === 'status' || path === 'pending') ? 'GET' : 'POST'
    expect((await req(path, undefined, method)).status).toBe(401)
    expect((await req(path, 'client', method)).status).toBe(403)
  })
  it('returns setup state only to verified admins with no-store', async () => {
    const res = await req('status', 'admin', 'GET')
    expect(await res.json()).toEqual({ configured: false, scope: ['Contacts', 'Follow-ups'], liveWritesEnabled: false, googleWritesEnabled: false, mode: 'off' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
  it('fails closed for live preview and apply until durable adapter is available', async () => {
    expect((await req('preview', 'admin')).status).toBe(503)
    expect((await req('apply', 'admin', 'POST', { previewId: uuid, choices: {} })).status).toBe(503)
  })
  it('rejects destinations and plans supplied by clients', async () => {
    expect((await req('apply', 'admin', 'POST', { previewId: uuid, spreadsheetId: 'attacker', plan: [] })).status).toBe(400)
  })
  it('does not call the coordinator apply path for a valid admin in preview-only mode', async () => {
    const coordinator = new SyncCoordinator({} as SyncStore)
    const apply = vi.spyOn(coordinator, 'apply')
    const preview = createApp(undefined, { ...deps, coordinator: () => coordinator, mode: () => 'preview' })
    const before = await preview.request('/api/sync/status', { headers: { Authorization: 'Bearer admin' } }, env)
    expect(await before.json()).toMatchObject({ mode: 'preview', liveWritesEnabled: false, googleWritesEnabled: false })
    const res = await preview.request('/api/sync/apply', { method: 'POST', headers: { Authorization: 'Bearer admin' },
      body: JSON.stringify({ previewId: uuid, choices: {} }) }, env)
    expect(res.status).toBe(503)
    expect(apply).not.toHaveBeenCalled()
  })
  it('cannot select the dormant writer through production configuration', async () => {
    const configured = { SUPABASE_URL: 'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-value',
      CRM_SHEETS_SYNC_ID: 'synthetic_workbook', CRM_SHEETS_SYNC_ACCOUNT: 'example@synthetic.iam.gserviceaccount.com',
      CRM_SHEETS_SYNC_KEY: 'not a key', CRM_SHEETS_SYNC_MODE: 'two_way' }
    expect(productionSyncMode(configured)).toBe('off')
    expect(productionCoordinator(configured)).toBeNull()
    const realFactory = createApp(undefined, { ...deps, coordinator: productionCoordinator, mode: productionSyncMode })
    const fetcher = vi.spyOn(globalThis, 'fetch')
    try {
      const res = await realFactory.request('/api/sync/apply', { method: 'POST', headers: { Authorization: 'Bearer admin' },
        body: JSON.stringify({ previewId: uuid, choices: {} }) }, configured)
      expect(res.status).toBe(503)
      expect(fetcher).not.toHaveBeenCalled()
    } finally { fetcher.mockRestore() }
  })
  it('does not leak authorization-provider errors', async () => {
    const bad = createApp(undefined, { ...deps, adminUser: async () => { throw new Error('secret credential') } })
    const res = await bad.request('/api/sync/status', { headers: { Authorization: 'Bearer anything' } }, env)
    expect(res.status).toBe(503); expect(await res.text()).not.toContain('secret')
  })
})
