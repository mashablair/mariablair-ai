import type { Context } from 'hono'
import type { AppContext } from './app'
import type { Deps } from './deps'

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Constant-time comparison, so the response time does not leak how much of a signature matched. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Checks Stripe's `Stripe-Signature` header: HMAC-SHA256 of "<timestamp>.<raw body>" with the endpoint's
 * signing secret, and a timestamp within 5 minutes (blocks replays). Uses Web Crypto, no Stripe SDK.
 */
export async function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSeconds = Date.now() / 1000, toleranceSeconds = 300) {
  if (!header) return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const timestamp = parts.find(([k]) => k === 't')?.[1]
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '')
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`)))
  return signatures.some((s) => safeEqual(s, expected))
}

export type StripePayment = {
  checkout_session_id: string; payment_intent_id: string | null; amount_cents: number; email: string | null; name: string | null
  payment_link_id: string | null; paid_on: string
}
type CheckoutSession = {
  id: string; payment_status?: string; amount_total?: number | null; currency?: string | null; created?: number
  payment_intent?: string | { id: string } | null; payment_link?: string | { id: string } | null
  customer_details?: { email?: string | null; name?: string | null } | null; customer_email?: string | null
}
type StripeEvent = { id: string; type: string; created?: number; data?: { object?: CheckoutSession } }

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id ?? null)

/** The payment inside an event, or null when the event is not a paid US-dollar checkout. */
export function paymentFromEvent(event: StripeEvent): StripePayment | null {
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return null
  const s = event.data?.object
  if (!s?.id || s.payment_status !== 'paid' || typeof s.amount_total !== 'number' || (s.currency ?? 'usd') !== 'usd') return null
  return {
    checkout_session_id: s.id,
    payment_intent_id: idOf(s.payment_intent),
    amount_cents: s.amount_total,
    email: s.customer_details?.email ?? s.customer_email ?? null,
    name: s.customer_details?.name ?? null,
    payment_link_id: idOf(s.payment_link),
    // The business works in Florida, so the calendar date is taken in Eastern time.
    paid_on: new Date((s.created ?? event.created ?? Date.now() / 1000) * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
  }
}

/** POST /api/stripe/webhook: verify the signature, store the raw event (idempotent), match the payment. */
export async function handleStripeWebhook(c: Context<AppContext>, deps: Deps) {
  const env = c.env
  if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return c.json({ error: 'not_configured' }, 503)
  const raw = await c.req.text()
  if (!(await verifyStripeSignature(raw, c.req.header('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) return c.json({ error: 'bad_signature' }, 400)
  let event: StripeEvent
  try {
    event = JSON.parse(raw) as StripeEvent
  } catch {
    return c.json({ error: 'invalid' }, 400)
  }
  if (!event?.id || !event.type) return c.json({ error: 'invalid' }, 400)
  // A database error throws -> 500 -> Stripe retries later. Safe, because recording is idempotent.
  const result = await deps.recordStripeEvent(env, { p_event_id: event.id, p_type: event.type, p_payload: event, p_payment: paymentFromEvent(event) })
  return c.json({ received: true, status: result.status })
}
