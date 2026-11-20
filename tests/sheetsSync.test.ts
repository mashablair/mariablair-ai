import { describe, expect, it } from 'vitest'
import { normalizeSyncRecords, planSync, resolveSync, type SyncRecord, type SyncInput } from '../shared/sheetsSync'

const contact = (id: string, fields: Record<string, string> = {}): SyncRecord => ({ kind: 'contacts', id, fields: { name: 'Sample Person', source: '', next_action: '', follow_up_date: '', ...fields } })
const one = (sheet: SyncRecord, app: SyncRecord, base?: SyncRecord): SyncInput => ({ sheet: [sheet], app: [app], baseline: base ? [base] : [] })

describe('three-way Sheets sync', () => {
  it('merges independent changes field by field, never by row counts or timestamps', () => {
    const base = contact('C001')
    const input = one(contact('C001', { next_action: 'Call' }), contact('C001', { source: 'Workshop' }), base)
    const original = JSON.stringify(input)
    expect(planSync(input).changes.map((c) => c.direction)).toEqual(['to_sheet', 'to_app'])
    const result = resolveSync(input)
    expect(result.writes).toHaveLength(2)
    expect(result.baseline[0]?.fields).toMatchObject({ source: 'Workshop', next_action: 'Call' })
    expect(JSON.stringify(input)).toBe(original)
    expect(planSync({ sheet: result.baseline, app: result.baseline, baseline: result.baseline }).changes).toEqual([])
  })
  it('requires a deliberate first-sync choice even when one value is blank', () => {
    const input = one(contact('C001', { next_action: 'Call' }), contact('C001'))
    const p = planSync(input)
    expect(p.changes[0]?.direction).toBe('conflict')
    expect(() => resolveSync(input)).toThrow('every conflict')
    const result = resolveSync(input, { 'contacts:C001:next_action': 'sheet' })
    expect(result.writes[0]).toMatchObject({ side: 'app', fields: { next_action: 'Call' } })
  })
  it('flags differing edits on both sides and accepts either explicit resolution', () => {
    const input = one(contact('C001', { next_action: 'Call' }), contact('C001', { next_action: 'Email' }), contact('C001'))
    expect(planSync(input).changes[0]?.direction).toBe('conflict')
    expect(resolveSync(input, { 'contacts:C001:next_action': 'app' }).writes[0]).toMatchObject({ side: 'sheet', fields: { next_action: 'Email' } })
  })
  it('treats intentional field clearing as a change but never as record deletion', () => {
    const input = one(contact('C001'), contact('C001', { next_action: 'Call' }), contact('C001', { next_action: 'Call' }))
    expect(resolveSync(input).writes[0]?.fields.next_action).toBe('')
  })
  it('advances baseline without writes when both sides made the same change', () => {
    const updated = contact('C001', { source: 'Event' })
    const result = resolveSync(one(updated, updated, contact('C001')))
    expect(result.writes).toEqual([])
    expect(result.baseline[0]?.fields.source).toBe('Event')
  })
  it('adds one-sided new rows with the stable ID and never transfers unknown fields', () => {
    const input: SyncInput = { sheet: [contact('C001')], app: [{ kind: 'tasks', id: 'F001', fields: { title: 'Call', contact_id: '', status: 'open' } }], baseline: [] }
    const result = resolveSync(input)
    expect(result.writes.map((w) => [w.side, w.id, w.create])).toEqual([['app', 'C001', true], ['sheet', 'F001', true]])
    expect(result.baseline).toHaveLength(2)
  })
  it('does not recreate or delete previously linked missing records', () => {
    for (const input of [
      { sheet: [], app: [contact('C001')], baseline: [contact('C001')] },
      { sheet: [contact('C001')], app: [], baseline: [contact('C001')] },
      { sheet: [], app: [], baseline: [contact('C001')] },
    ]) {
      expect(planSync(input).warnings).toHaveLength(1)
      expect(resolveSync(input).writes).toEqual([])
      expect(resolveSync(input).baseline).toEqual([contact('C001')])
    }
  })
  it('rejects duplicate IDs independently in every snapshot', () => {
    for (const side of ['sheet', 'app', 'baseline'] as const) {
      const input: SyncInput = { sheet: [], app: [], baseline: [] }
      input[side] = [contact('C001'), contact('C001')]
      expect(() => planSync(input)).toThrow('Duplicate')
    }
  })
  it('rejects private, unknown, malformed fields and IDs', () => {
    expect(() => normalizeSyncRecords([contact('C001', { internal_notes: 'private' })])).toThrow('Unsupported')
    expect(() => normalizeSyncRecords([contact(' C001')])).toThrow('Invalid')
    expect(() => normalizeSyncRecords([contact('C:001')])).toThrow('Invalid')
    expect(() => normalizeSyncRecords([contact('C001', { name: null as unknown as string })])).toThrow('Invalid')
  })
  it('rejects extra/invalid choice keys and does not allow client-directed arbitrary writes', () => {
    const input = one(contact('C001'), contact('C001'))
    expect(() => resolveSync(input, { arbitrary: 'sheet' })).toThrow('Invalid conflict')
  })
  it('separates identical IDs across tables and normalizes omitted allowed fields', () => {
    expect(normalizeSyncRecords([contact('1'), { kind: 'tasks', id: '1', fields: { title: 'Sample', status: 'open' } }])).toHaveLength(2)
    expect(normalizeSyncRecords([{ kind: 'tasks', id: 'F001', fields: { title: 'Sample', status: 'open' } }])[0]?.fields).toEqual({ title: 'Sample', contact_id: '', due_date: '', status: 'open' })
  })
})


describe('sync canonical validation', () => {
  const task = (fields: Record<string, string> = {}): SyncRecord => ({ kind: 'tasks', id: 'F001', fields: { title: 'Example task', contact_id: '', due_date: '', status: 'open', ...fields } })
  it('allows only valid canonical ISO dates and empty dates', () => {
    for (const date of ['', '2024-02-29', '2026-11-17']) {
      expect(() => normalizeSyncRecords([contact('C001', { follow_up_date: date }), task({ due_date: date })])).not.toThrow()
    }
    for (const date of ['11/17/2026', '2026-02-29', '2026-04-31', 'tomorrow', '2026-1-01', '2026-11-17T00:00:00Z', '2026-13-01', '2026-00-01']) {
      expect(() => normalizeSyncRecords([contact('C001', { follow_up_date: date })])).toThrow('Dates')
      expect(() => normalizeSyncRecords([task({ due_date: date })])).toThrow('Dates')
    }
  })
  it('requires explicit canonical task status', () => {
    for (const status of ['open', 'done']) expect(() => normalizeSyncRecords([task({ status })])).not.toThrow()
    for (const status of ['', 'Done', 'cancelled', 'pending', 'in progress']) expect(() => normalizeSyncRecords([task({ status })])).toThrow('status')
    expect(() => normalizeSyncRecords([{ kind: 'tasks', id: 'F001', fields: { title: 'Missing status' } }])).toThrow('status')
  })
  it('checks task references within each snapshot, independent of ordering', () => {
    expect(() => normalizeSyncRecords([task({ contact_id: 'C001' }), contact('C001')])).not.toThrow()
    expect(() => normalizeSyncRecords([task({ contact_id: 'C001' })])).toThrow('same snapshot')
    expect(() => planSync({ sheet: [task({ contact_id: 'C001' })], app: [contact('C001')], baseline: [] })).toThrow('same snapshot')
  })
  it('bounds record counts and record and field lengths', () => {
    expect(() => normalizeSyncRecords(Array.from({ length: 2000 }, (_, i) => contact(`C${i}`)))).not.toThrow()
    expect(() => normalizeSyncRecords(Array.from({ length: 2001 }, (_, i) => contact(`C${i}`)))).toThrow('2000-record')
    expect(() => normalizeSyncRecords([contact('x'.repeat(100), { name: 'x'.repeat(10000) })])).not.toThrow()
    expect(() => normalizeSyncRecords([contact('x'.repeat(101))])).toThrow('ID')
    expect(() => normalizeSyncRecords([contact('C001', { name: 'x'.repeat(10001) })])).toThrow('field value')
  })
  it('rejects a resolved link to a contact missing on the destination side', () => {
    const input: SyncInput = {
      sheet: [contact('C001'), task({ contact_id: 'C001' })],
      app: [task()],
      baseline: [contact('C001'), task()],
    }
    expect(() => resolveSync(input)).toThrow('same snapshot')
  })
})
