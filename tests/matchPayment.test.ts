import { describe, expect, it } from 'vitest'
import { DemoRepository } from '../app/src/data/demoRepository'
import { matchPayment } from '../app/src/data/repository'

describe('payment review queue', () => {
  it('keeps unknown Stripe payments out of balances until matched, then grants the offer once', async () => {
    const r = new DemoRepository()
    const p = await r.simulateStripePayment('unknown')
    expect(p).toMatchObject({ match_status: 'unmatched', contact_id: null })
    const paid = async () => (await r.balances()).find((b) => b.contact_id === 'c-4')!.paid_cents
    expect(await paid()).toBe(0)
    await matchPayment(r, p, 'c-4', p.offer_id)
    await matchPayment(r, (await r.get('payments', p.id))!, 'c-4', p.offer_id) // pressing Match twice is harmless
    expect(await paid()).toBe(19800)
    expect(await r.list('entitlements', { where: { payment_id: p.id } })).toHaveLength(1)
  })

  it('auto-matches a known client: entitlement and stage move', async () => {
    const r = new DemoRepository()
    const p = await r.simulateStripePayment('known')
    expect(p.match_status).toBe('matched')
    expect((await r.get('contacts', 'c-2'))!.stage).toBe('active_client')
    expect(await r.list('entitlements', { where: { payment_id: p.id } })).toHaveLength(1)
  })

  it('shows the demo client only their own shared things', async () => {
    const r = new DemoRepository()
    expect((await r.myRecommendations()).map((x) => x.shared)).toEqual([true, true])
    expect((await r.myMaterials()).map((m) => m.id).sort()).toEqual(['m-1', 'm-2'])
    expect((await r.myProducts()).map((x) => x.offer.key)).toEqual(['ai_training_session'])
    const sessions = await r.mySessions()
    expect(sessions.length).toBe(3)
    expect(Object.keys(sessions[0]!)).not.toContain('plan')
  })
})
