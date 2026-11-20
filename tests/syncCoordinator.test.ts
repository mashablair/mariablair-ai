import { describe, expect, it } from 'vitest'
import { SyncCoordinator, type SyncStore, type SyncPreview, type SyncReceipt } from '../server/sync/coordinator'
import type { SyncInput, SyncRecord } from '../shared/sheetsSync'

const contact = (action: string): SyncRecord => ({ kind: 'contacts', id: 'C001', fields: { name: 'Sample Person', source: 'Event', next_action: action, follow_up_date: '' } })
function setup() {
  let input: SyncInput = { sheet: [contact('Call')], app: [contact('Email')], baseline: [contact('Email')] }
  const previews = new Map<string, SyncPreview>(), receipts = new Map<string, SyncReceipt>()
  let held = false, now = 10, writes = 0, fault: 'none' | 'before' | 'after' = 'none'
  const store: SyncStore = {
    async acquire() { if (held) return null; held = true; return async () => { held = false } },
    async read() { return structuredClone(input) },
    async pendingReceipt() { return structuredClone([...receipts.values()].find(r => r.phase !== 'complete') ?? null) },
    async putPreview(p) { previews.set(p.id, structuredClone(p)) }, async getPreview(id) { return structuredClone(previews.get(id) ?? null) },
    async getReceipt(id) { return structuredClone(receipts.get(id) ?? null) }, async putReceipt(r) { receipts.set(r.id, structuredClone(r)) },
    async writeApp(expected, target) {
      expect([...receipts.values()].some(r => r.phase === 'prepared')).toBe(true)
      expect(input.app).toEqual(expected)
      writes++
      if (fault === 'before') throw new Error('timeout')
      input.app = structuredClone(target)
      if (fault === 'after') throw new Error('timeout after commit')
    },
    async writeSheet(expected, target) { expect(input.sheet).toEqual(expected); input.sheet = structuredClone(target); writes++ },
    async saveBaseline(expected, target) { expect(input.baseline).toEqual(expected); input.baseline = structuredClone(target) },
  }
  let seq = 0
  const coordinator = new SyncCoordinator(store, () => now, () => `preview-${++seq}`)
  return { coordinator, store, previews, receipts, input: () => input, writes: () => writes, setNow: (n: number) => { now = n }, setFault: (f: typeof fault) => { fault = f }, lock: () => { held = true } }
}
describe('sync durable coordinator contract', () => {
  it('previews without writes, applies then advances baseline, and replay is idempotent', async () => {
    const s = setup(); const p = await s.coordinator.preview('admin')
    expect(s.writes()).toBe(0); expect(p.plan.changes).toHaveLength(1)
    expect(await s.coordinator.apply('admin', p.id, {})).toEqual({ status: 'complete', replay: false })
    expect(s.input().app).toEqual(s.input().sheet); expect(s.input().baseline).toEqual(s.input().app)
    await s.coordinator.apply('admin', p.id, {}); expect(s.writes()).toBe(1)
  })
  it('binds previews and completed receipts to their admin', async () => {
    const s = setup(), p = await s.coordinator.preview('admin')
    await expect(s.coordinator.apply('other', p.id, {})).rejects.toMatchObject({ code: 'not_found' })
    await s.coordinator.apply('admin', p.id, {})
    await expect(s.coordinator.apply('other', p.id, {})).rejects.toMatchObject({ code: 'not_found' })
  })
  it('rejects expired and stale previews before any writes', async () => {
    const s = setup(), p = await s.coordinator.preview('admin'); s.setNow(700000)
    await expect(s.coordinator.apply('admin', p.id, {})).rejects.toMatchObject({ code: 'expired' })
    const p2 = await s.coordinator.preview('admin'); s.input().sheet[0]!.fields.next_action = 'Newer edit'
    await expect(s.coordinator.apply('admin', p2.id, {})).rejects.toMatchObject({ code: 'stale' })
    expect(s.writes()).toBe(0)
  })
  it('rejects overlapping applies', async () => {
    const s = setup(), p = await s.coordinator.preview('admin'); s.lock()
    await expect(s.coordinator.apply('admin', p.id, {})).rejects.toMatchObject({ code: 'busy' })
  })
  it('never retries uncertain writes or advances baseline after partial failure', async () => {
    const s = setup(), p = await s.coordinator.preview('admin'), p2 = await s.coordinator.preview('admin'); s.setFault('before')
    await expect(s.coordinator.apply('admin', p.id, {})).rejects.toMatchObject({ code: 'needs_review' })
    await expect(s.coordinator.apply('admin', p.id, {})).rejects.toMatchObject({ code: 'needs_review' })
    await expect(s.coordinator.apply('admin', p2.id, {})).rejects.toMatchObject({ code: 'needs_review' })
    await expect(s.coordinator.preview('admin')).rejects.toMatchObject({ code: 'needs_review' })
    expect(s.writes()).toBe(1); expect(s.input().baseline[0]!.fields.next_action).toBe('Email')
  })
  it('recovers an after-commit timeout by reading, never repeating the write', async () => {
    const s = setup(), p = await s.coordinator.preview('admin'); s.setFault('after')
    await expect(s.coordinator.apply('admin', p.id, {})).rejects.toMatchObject({ code: 'needs_review' })
    expect(await s.coordinator.apply('admin', p.id, {})).toMatchObject({ status: 'complete' })
    expect(s.writes()).toBe(1); expect(s.input().baseline).toEqual(s.input().sheet)
  })
})
