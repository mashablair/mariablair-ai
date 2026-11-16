import { describe, expect, it } from 'vitest'
import { DemoRepository } from '../app/src/data/demoRepository'

describe('demo repository', () => {
  it('lists, filters, inserts with defaults, updates and removes', async () => {
    const r = new DemoRepository()
    const before = await r.list('contacts')
    expect(before.length).toBeGreaterThan(3)
    const made = await r.insert('contacts', { first_name: 'Test' })
    expect(made).toMatchObject({ first_name: 'Test', last_name: '', stage: 'new', email: null })
    expect((await r.update('contacts', made.id, { stage: 'contacted' })).stage).toBe('contacted')
    expect(await r.list('contacts', { where: { stage: 'contacted', first_name: 'Test' } })).toHaveLength(1)
    await r.remove('contacts', made.id)
    expect(await r.get('contacts', made.id)).toBeNull()
  })

  it('rejects a duplicate email like the database does', async () => {
    const r = new DemoRepository()
    const [first] = await r.list('contacts', { where: { id: 'c-1' } })
    await expect(r.insert('contacts', { first_name: 'Dup', email: first!.email })).rejects.toThrow(/already exists/)
  })

  it('cascades deletes like the schema', async () => {
    const r = new DemoRepository()
    await r.remove('contacts', 'c-1')
    expect(await r.list('sessions', { where: { contact_id: 'c-1' } })).toEqual([])
    expect(await r.list('internal_notes', { where: { contact_id: 'c-1' } })).toEqual([])
  })

  it('links and unlinks join rows idempotently', async () => {
    const r = new DemoRepository()
    await r.link('contact_events', { contact_id: 'c-1', event_id: 'e-1' })
    await r.link('contact_events', { contact_id: 'c-1', event_id: 'e-1' })
    expect(await r.links('contact_events', { contact_id: 'c-1' })).toHaveLength(1)
    await r.unlink('contact_events', { contact_id: 'c-1', event_id: 'e-1' })
    expect(await r.links('contact_events', { contact_id: 'c-1' })).toEqual([])
  })

  it('computes balances as charges minus matched payments', async () => {
    const r = new DemoRepository()
    await r.insert('charges', { contact_id: 'c-2', description: 'Session', amount_cents: 19800 })
    await r.insert('payments', { contact_id: 'c-2', amount_cents: 9900 })
    await r.insert('payments', { contact_id: null, amount_cents: 5000, match_status: 'needs_review' })
    expect((await r.balances()).find((b) => b.contact_id === 'c-2')).toMatchObject({ charged_cents: 19800, paid_cents: 9900, balance_cents: 9900 })
  })
})
