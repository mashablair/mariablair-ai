import { describe, expect, it } from 'vitest'
import { createApp, type Env } from '../server/app'
import type { Deps, SubmitAssessmentArgs } from '../server/deps'
import type { Email } from '../server/email'
import { QUESTIONS } from '../shared/assessment'
import { questionsFor, type Answers } from '../shared/assessmentEngine'

const answers = (): Answers => {
  const a: Answers = { track: 'business' }
  for (const q of questionsFor('business')) if (q.id !== 'track') a[q.id] = q.type === 'multi' ? [q.options[0]!.id] : q.options[0]!.id
  return a
}
const ENV: Env = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', RESEND_API_KEY: 're', EMAIL_FROM: 'Maria <m@example.com>',
  ADMIN_NOTIFY_EMAIL: 'maria@example.com', TURNSTILE_SECRET_KEY: 'ts', PUBLIC_SITE_URL: 'https://mariablairai.com',
}

function setup(over: Partial<Deps> = {}) {
  const saved: SubmitAssessmentArgs[] = []
  const emails: Email[] = []
  const deps: Deps = {
    verifyTurnstile: async (_e, token) => token === 'good',
    saveSubmission: async (_e, args) => { saved.push(args); return { contact_id: 'c1', submission_id: 's1', is_new_contact: true } },
    sendEmail: async (_e, email) => { emails.push(email) },
    recordStripeEvent: async () => ({ status: 'stored' }),
    ...over,
  }
  const app = createApp(deps)
  const post = (body: unknown, env: Partial<Env> = ENV) =>
    app.request('/api/assessment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)
  return { post, saved, emails }
}
const body = (over: object = {}) => ({ answers: answers(), contact: { first_name: 'Priya', last_name: 'Nair', email: 'Priya@Books.example', company: 'Palmetto <Books>' }, turnstileToken: 'good', ...over })

describe('POST /api/assessment', () => {
  it('stores the submission, emails the results and notifies Maria', async () => {
    const { post, saved, emails } = setup()
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, emailed: true })
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ p_track: 'business', p_level: 'curious', p_offer_key: 'free_call', p_contact: { email: 'priya@books.example', first_name: 'Priya' } })
    expect(saved[0]!.p_recommendations).toHaveLength(3)
    expect(saved[0]!.p_task_title).toBe('Follow up on assessment: Priya Nair (Curious)')
    expect(saved[0]!.p_contact.business_type).toBe(QUESTIONS.find((q) => q.id === 'b_industry')!.options[0]!.label)
    expect(emails.map((e) => e.to)).toEqual(['priya@books.example', 'maria@example.com'])
    expect(emails[0]!.subject).toBe('Your AI assessment results: Curious')
    expect(emails[0]!.html).toContain('Hi Priya,')
    expect(emails[0]!.text).toContain('1. ')
    expect(emails[1]!.text).toContain('https://mariablairai.com/admin/contacts/c1')
    expect(emails[1]!.html).toContain('Palmetto &lt;Books&gt;')
  })

  it('does not return the results to the browser', async () => {
    const { post } = setup()
    const json = await (await post(body())).json()
    expect(Object.keys(json as object).sort()).toEqual(['emailed', 'ok'])
  })

  it('rejects a failed or missing bot check before saving anything', async () => {
    const { post, saved } = setup()
    expect((await post(body({ turnstileToken: 'bad' }))).status).toBe(403)
    expect((await post(body({ turnstileToken: undefined }))).status).toBe(403)
    expect(saved).toHaveLength(0)
  })

  it('refuses to run without a bot-check secret anywhere but localhost', async () => {
    const { post, saved } = setup()
    expect((await post(body(), { ...ENV, TURNSTILE_SECRET_KEY: undefined })).status).toBe(503)
    expect(saved).toHaveLength(0)
    expect((await post(body(), { ...ENV, TURNSTILE_SECRET_KEY: undefined, PUBLIC_SITE_URL: 'http://localhost:8788' })).status).toBe(200)
  })

  it('rejects bad input', async () => {
    const { post, saved } = setup()
    expect((await post(body({ contact: { first_name: 'A', email: 'nope' } }))).status).toBe(400)
    expect((await post(body({ answers: { track: 'business' } }))).status).toBe(400)
    expect((await post(body({ answers: { ...answers(), b_use: 'hacked' } }))).status).toBe(400)
    expect((await post('not json')).status).toBe(400)
    expect(saved).toHaveLength(0)
  })

  it('keeps the lead when the email provider fails', async () => {
    const { post, saved } = setup({ sendEmail: async () => { throw new Error('resend down') } })
    const res = await post(body())
    expect(await res.json()).toEqual({ ok: true, emailed: false })
    expect(saved).toHaveLength(1)
  })

  it('reports not configured without database settings', async () => {
    const { post } = setup()
    expect((await post(body(), {})).status).toBe(503)
  })
})
