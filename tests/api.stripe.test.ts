import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp, type Env } from '../server/app'
import type { Deps, RecordStripeEventArgs } from '../server/deps'
import { paymentFromEvent, verifyStripeSignature } from '../server/stripe'

const SECRET = 'whsec_test'
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', STRIPE_WEBHOOK_SECRET: SECRET } as Env
const sign = (body: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`

const event = (over: object = {}) => ({
  id: 'evt_1', type: 'checkout.session.completed', created: 1794800000,
  data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 19800, currency: 'usd', created: 1794800000, payment_intent: 'pi_1', payment_link: 'plink_1',
    customer_details: { email: 'Elena@Dental.example', name: 'Elena Marsh' }, ...over } },
})

function setup() {
  const recorded: RecordStripeEventArgs[] = []
  const deps = { recordStripeEvent: async (_e: Env, a: RecordStripeEventArgs) => { recorded.push(a); return { status: 'matched' } } } as unknown as Deps
  const app = createApp(deps)
  const post = (body: string, signature: string | undefined, env: Partial<Env> = ENV) =>
    app.request('/api/stripe/webhook', { method: 'POST', body, headers: signature ? { 'Stripe-Signature': signature } : {} }, env)
  return { post, recorded }
}

describe('Stripe signature', () => {
  it('accepts a valid signature and rejects tampering, wrong secrets and old timestamps', async () => {
    const body = '{"id":"evt_1"}'
    expect(await verifyStripeSignature(body, sign(body), SECRET)).toBe(true)
    expect(await verifyStripeSignature(body + ' ', sign(body), SECRET)).toBe(false)
    expect(await verifyStripeSignature(body, sign(body, 'whsec_other'), SECRET)).toBe(false)
    expect(await verifyStripeSignature(body, sign(body, SECRET, Math.floor(Date.now() / 1000) - 3600), SECRET)).toBe(false)
    expect(await verifyStripeSignature(body, undefined, SECRET)).toBe(false)
    expect(await verifyStripeSignature(body, 't=abc,v1=', SECRET)).toBe(false)
    expect(await verifyStripeSignature(body, `${sign(body, 'old_secret')},${sign(body).split(',')[1]}`.replace(/t=\d+,/, `t=${Math.floor(Date.now() / 1000)},`), SECRET)).toBe(true)
  })
})

describe('paymentFromEvent', () => {
  it('extracts a paid checkout', () => {
    expect(paymentFromEvent(event())).toEqual({
      checkout_session_id: 'cs_1', payment_intent_id: 'pi_1', amount_cents: 19800, email: 'Elena@Dental.example', name: 'Elena Marsh', payment_link_id: 'plink_1',
      paid_on: new Date(1794800000 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    })
  })
  it('ignores unpaid checkouts, other currencies and other event types', () => {
    expect(paymentFromEvent(event({ payment_status: 'unpaid' }))).toBeNull()
    expect(paymentFromEvent(event({ currency: 'eur' }))).toBeNull()
    expect(paymentFromEvent({ ...event(), type: 'charge.refunded' })).toBeNull()
  })
})

describe('POST /api/stripe/webhook', () => {
  it('records a signed event with the raw payload and the extracted payment', async () => {
    const { post, recorded } = setup()
    const body = JSON.stringify(event())
    const res = await post(body, sign(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, status: 'matched' })
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ p_event_id: 'evt_1', p_type: 'checkout.session.completed', p_payment: { checkout_session_id: 'cs_1', amount_cents: 19800 } })
    expect(recorded[0]!.p_payload).toEqual(event())
  })
  it('stores unrelated events without a payment', async () => {
    const { post, recorded } = setup()
    const body = JSON.stringify({ id: 'evt_2', type: 'customer.created', data: { object: { id: 'cus_1' } } })
    expect((await post(body, sign(body))).status).toBe(200)
    expect(recorded[0]!.p_payment).toBeNull()
  })
  it('rejects unsigned or forged requests before touching the database', async () => {
    const { post, recorded } = setup()
    const body = JSON.stringify(event())
    expect((await post(body, undefined)).status).toBe(400)
    expect((await post(body, sign(body, 'whsec_wrong'))).status).toBe(400)
    expect((await post(body.replace('19800', '1'), sign(body))).status).toBe(400)
    expect(recorded).toHaveLength(0)
  })
  it('reports not configured without a signing secret', async () => {
    const { post } = setup()
    const body = JSON.stringify(event())
    expect((await post(body, sign(body), { ...ENV, STRIPE_WEBHOOK_SECRET: undefined })).status).toBe(503)
  })
})
