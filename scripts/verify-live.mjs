// Checks the real Supabase project end to end with throwaway data, then cleans up.
// Run: node scripts/verify-live.mjs   (reads .env.local and .dev.vars; prints no secrets)
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const f of ['.env.local', '.dev.vars']) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
const url = env.VITE_SUPABASE_URL
const anon = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const email = `verify-${Date.now()}@example.com`
let failed = false
const check = (name, ok, detail = '') => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

// 1. Anonymous visitors get nothing.
for (const t of ['contacts', 'internal_notes', 'assessment_submissions', 'payments', 'admins']) {
  const r = await anon.from(t).select('*').limit(1)
  check(`anon cannot read ${t}`, Boolean(r.error) || (r.data ?? []).length === 0, r.error?.message ?? 'empty')
}
const anonRpc = await anon.rpc('submit_assessment', { p_contact: { email }, p_version: 1, p_definition: {}, p_track: 'business', p_answers: {}, p_score: 0, p_level: 'curious', p_recommendations: [], p_offer_key: 'free_call', p_task_title: 'x' })
check('anon cannot call submit_assessment', Boolean(anonRpc.error), anonRpc.error?.message)

// 2. The API's write path (service role).
const sub = await admin.rpc('submit_assessment', {
  p_contact: { first_name: 'Verify', last_name: 'Script', email, company: '', business_type: '', ai_needs: '' }, p_version: 0, p_definition: { test: true },
  p_track: 'individual', p_answers: { track: 'individual' }, p_score: 1, p_level: 'curious', p_recommendations: [{ title: 'One', body: 'b' }], p_offer_key: 'free_call', p_task_title: 'Verify task',
})
check('submit_assessment stores a submission', !sub.error && sub.data?.is_new_contact === true, sub.error?.message)
const contactId = sub.data?.contact_id

// 3. Stripe path: unknown link ignored, known link + known email matched, replay is a no-op.
const evt = `evt_verify_${Date.now()}`
const pay = (link) => ({ checkout_session_id: `cs_${evt}_${link}`, payment_intent_id: null, amount_cents: 9900, email, name: 'Verify Script', payment_link_id: link, paid_on: '2026-11-16' })
const ignored = await admin.rpc('record_stripe_event', { p_event_id: `${evt}_a`, p_type: 'checkout.session.completed', p_payload: {}, p_payment: pay('plink_other_business') })
check('other products are ignored', ignored.data?.status === 'ignored', ignored.error?.message ?? ignored.data?.status)
const matched = await admin.rpc('record_stripe_event', { p_event_id: `${evt}_b`, p_type: 'checkout.session.completed', p_payload: {}, p_payment: pay('plink_1UTlgZ1PqsZvBWX7RCGqOpQT') })
check('training-session payment is auto-matched', matched.data?.status === 'matched', matched.error?.message ?? matched.data?.status)
const replay = await admin.rpc('record_stripe_event', { p_event_id: `${evt}_b`, p_type: 'checkout.session.completed', p_payload: {}, p_payment: pay('plink_1UTlgZ1PqsZvBWX7RCGqOpQT') })
check('replayed event is a no-op', replay.data?.status === 'duplicate', replay.data?.status)

// 4. A signed-in client sees only their own rows; and is not an admin.
const other = await admin.from('contacts').insert({ first_name: 'Other', email: `other-${email}` }).select().single()
await admin.from('internal_notes').insert({ contact_id: contactId, body: 'secret note' })
await admin.from('assessment_submissions').insert({ contact_id: other.data.id, track: 'business', answers: {}, score: 0, level: 'curious' })
const user = await admin.auth.admin.createUser({ email, email_confirm: true })
const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
const session = await anon.auth.verifyOtp({ email, token: link.data?.properties?.email_otp ?? '', type: 'email' })
check('client can sign in with an emailed code', !session.error, session.error?.message)
const client = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${session.data?.session?.access_token}` } } })
const who = await client.rpc('link_my_account')
check('account links to its contact by verified email', who.data?.contact_id === contactId && who.data?.is_admin === false, who.error?.message)
const subs = await client.from('assessment_submissions').select('contact_id')
check('client sees only their own submission', subs.data?.length === 1 && subs.data[0].contact_id === contactId, `${subs.data?.length} rows`)
for (const t of ['contacts', 'internal_notes', 'tasks', 'payments', 'charges', 'stripe_events']) {
  const r = await client.from(t).select('*')
  check(`client cannot read ${t}`, (r.data ?? []).length === 0, r.error?.message ?? 'empty')
}
const products = await client.from('entitlements').select('contact_id')
check('client sees their purchased product', products.data?.length === 1 && products.data[0].contact_id === contactId)
const write = await client.from('internal_notes').insert({ contact_id: contactId, body: 'x' })
check('client cannot write', Boolean(write.error), write.error?.message)

// 5. Storage bucket exists and is private.
const bucket = await admin.storage.getBucket('materials')
check('materials bucket is private', bucket.data?.public === false, bucket.error?.message)

// Clean up everything this script created.
if (user.data?.user) await admin.auth.admin.deleteUser(user.data.user.id)
await admin.from('payments').delete().like('stripe_checkout_session_id', `cs_${evt}%`)
await admin.from('stripe_events').delete().like('id', `${evt}%`)
await admin.from('contacts').delete().in('email', [email, `other-${email}`])
await admin.from('assessment_versions').delete().eq('version', 0)
const left = await admin.from('contacts').select('id', { count: 'exact', head: true })
console.log(`cleaned up; contacts now in database: ${left.count}`)
process.exit(failed ? 1 : 0)
