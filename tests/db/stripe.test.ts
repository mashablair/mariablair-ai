import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, errorOf } from './harness'

let db: PGlite
let n = 0
const record = async (payment: object | null, eventId = `evt_${++n}`, type = 'checkout.session.completed') =>
  db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`)
    const r = await tx.query<{ r: any }>(`select record_stripe_event($1, $2, '{"raw":true}'::jsonb, $3::jsonb) as r`, [eventId, type, payment ? JSON.stringify(payment) : null])
    return r.rows[0]!.r
  })
const pay = (over: object = {}) => ({ checkout_session_id: `cs_${++n}`, payment_intent_id: `pi_${n}`, amount_cents: 19800, email: 'Elena@Dental.example', name: 'Elena Marsh', payment_link_id: 'plink_training', paid_on: '2026-11-10', ...over })

let elena: string
beforeAll(async () => {
  db = await createDb()
  await db.query(`update offers set stripe_payment_link_id = 'plink_training' where key = 'ai_training_session'`)
  elena = (await db.query<{ id: string }>(`insert into contacts (first_name, email, stage) values ('Elena', 'elena@dental.example', 'assessment_completed') returning id`)).rows[0]!.id
})

describe('record_stripe_event', () => {
  it('auto-matches a clear payment: known email and known payment link', async () => {
    const r = await record(pay())
    expect(r).toMatchObject({ status: 'matched', contact_id: elena })
    const p = (await db.query<any>(`select amount_cents, method, match_status, payer_email, paid_on::text from payments where id = $1`, [r.payment_id])).rows[0]
    expect(p).toEqual({ amount_cents: 19800, method: 'stripe', match_status: 'matched', payer_email: 'elena@dental.example', paid_on: '2026-11-10' })
    expect((await db.query<any>(`select source, o.key from entitlements e join offers o on o.id = e.offer_id where payment_id = $1`, [r.payment_id])).rows)
      .toEqual([{ source: 'purchase', key: 'ai_training_session' }])
    expect((await db.query<any>(`select stage from contacts where id = $1`, [elena])).rows[0].stage).toBe('active_client')
    expect((await db.query<any>(`select paid_cents from contact_balances where contact_id = $1`, [elena])).rows[0].paid_cents).toBe(19800)
  })

  it('is idempotent: a redelivered event or a second event for the same checkout changes nothing', async () => {
    const payment = pay()
    expect((await record(payment, 'evt_same')).status).toBe('matched')
    expect((await record(payment, 'evt_same')).status).toBe('duplicate')
    expect((await record(payment, 'evt_other', 'checkout.session.async_payment_succeeded')).status).toBe('duplicate')
    expect((await db.query(`select 1 from payments where stripe_checkout_session_id = $1`, [payment.checkout_session_id])).rows).toHaveLength(1)
    expect((await db.query(`select 1 from stripe_events where id in ('evt_same', 'evt_other') and processed_at is not null`)).rows).toHaveLength(2)
  })

  it('ignores payments for products that are not consulting offers, keeping only the raw event', async () => {
    const before = (await db.query<any>(`select count(*)::int as n from payments`)).rows[0].n
    expect(await record(pay({ payment_link_id: 'plink_dating_course' }), 'evt_other_biz')).toEqual({ status: 'ignored' })
    expect((await db.query<any>(`select count(*)::int as n from payments`)).rows[0].n).toBe(before)
    expect((await db.query(`select 1 from stripe_events where id = 'evt_other_biz' and processed_at is not null`)).rows).toHaveLength(1)
  })

  it('sends a known payer with no payment link to review, without an entitlement or balance change', async () => {
    const before = (await db.query<any>(`select paid_cents from contact_balances where contact_id = $1`, [elena])).rows[0].paid_cents
    const r = await record(pay({ payment_link_id: null }))
    expect(r).toMatchObject({ status: 'needs_review', contact_id: elena, offer_id: null })
    expect((await db.query(`select 1 from entitlements where payment_id = $1`, [r.payment_id])).rows).toHaveLength(0)
    expect((await db.query<any>(`select paid_cents from contact_balances where contact_id = $1`, [elena])).rows[0].paid_cents).toBe(before)
  })

  it('leaves an unknown payer unmatched and never creates a contact', async () => {
    const count = async () => (await db.query<any>(`select count(*)::int as n from contacts`)).rows[0].n
    const before = await count()
    const r = await record(pay({ email: 'stranger@example.com', name: 'A Stranger' }))
    expect(r).toMatchObject({ status: 'unmatched', contact_id: null })
    expect(await count()).toBe(before)
    expect((await db.query<any>(`select payer_name, match_status from payments where id = $1`, [r.payment_id])).rows[0]).toEqual({ payer_name: 'A Stranger', match_status: 'unmatched' })
  })

  it('stores other event types without creating payments', async () => {
    const before = (await db.query<any>(`select count(*)::int as n from payments`)).rows[0].n
    expect((await record(null, 'evt_misc', 'charge.refunded')).status).toBe('stored')
    expect((await db.query<any>(`select count(*)::int as n from payments`)).rows[0].n).toBe(before)
    expect((await db.query<any>(`select payload from stripe_events where id = 'evt_misc'`)).rows[0].payload).toEqual({ raw: true })
  })

  it('cannot be called by visitors or signed-in users', async () => {
    const user = (await db.query<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ('u@example.com', now()) returning id`)).rows[0]!.id
    const sql = `select record_stripe_event('evt_x', 't', '{}'::jsonb, null)`
    expect(await errorOf(db, null, sql)).toMatch(/permission denied/)
    expect(await errorOf(db, user, sql)).toMatch(/permission denied/)
  })
})
