import { describe, expect, it } from 'vitest'
import { createApp, type Env } from '../server/app'
import type { Deps, RequestCallArgs } from '../server/deps'
import type { Email } from '../server/email'

const ENV: Env = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', RESEND_API_KEY: 're', EMAIL_FROM: 'Maria <m@example.com>',
  ADMIN_NOTIFY_EMAIL: 'maria@example.com', TURNSTILE_SECRET_KEY: 'ts', PUBLIC_SITE_URL: 'https://mariablairai.com',
}

function setup(over: Partial<Deps> = {}) {
  const saved: RequestCallArgs[] = []
  const emails: Email[] = []
  const deps = {
    verifyTurnstile: async (_e: Env, token: string) => token === 'good',
    requestCall: async (_e: Env, args: RequestCallArgs) => { saved.push(args); return { contact_id: 'c9', is_new_contact: true } },
    sendEmail: async (_e: Env, email: Email) => { emails.push(email) },
    ...over,
  } as unknown as Deps
  const app = createApp(deps)
  const post = (body: unknown, env: Partial<Env> = ENV) =>
    app.request('/api/call-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)
  return { post, saved, emails }
}
const body = (over: object = {}) => ({
  name: ' Dana  Marie Cole ', email: ' Dana@Shop.example ', phone: '561-555-0100', company: 'Cole <Boutique>', message: 'Email takes all day.', turnstileToken: 'good', ...over,
})

describe('POST /api/call-request', () => {
  it('saves the lead and emails the visitor and Maria', async () => {
    const { post, saved, emails } = setup()
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(saved).toEqual([{
      p_contact: { first_name: 'Dana', last_name: 'Marie Cole', email: 'dana@shop.example', phone: '561-555-0100', company: 'Cole <Boutique>' },
      p_message: 'Email takes all day.', p_task_title: 'Reply to free call request: Dana  Marie Cole',
    }])
    expect(emails.map((e) => e.to)).toEqual(['dana@shop.example', 'maria@example.com'])
    expect(emails[0]!.html).toContain('Hi Dana,')
    expect(emails[0]!.text).toContain('https://mariablairai.com/assessment')
    expect(emails[1]!).toMatchObject({ replyTo: 'dana@shop.example' })
    expect(emails[1]!.text).toContain('https://mariablairai.com/admin/contacts/c9')
    expect(emails[1]!.html).toContain('Cole &lt;Boutique&gt;')
  })

  it('needs only a name and email', async () => {
    const { post, saved } = setup()
    expect((await post({ name: 'Sam', email: 'sam@example.com', turnstileToken: 'good' })).status).toBe(200)
    expect(saved[0]!.p_contact).toEqual({ first_name: 'Sam', last_name: '', email: 'sam@example.com', phone: '', company: '' })
  })

  it('rejects bad input and failed bot checks before saving anything', async () => {
    const { post, saved } = setup()
    expect((await post(body({ email: 'nope' }))).status).toBe(400)
    expect((await post(body({ name: '  ' }))).status).toBe(400)
    expect((await post(body({ message: 'x'.repeat(2001) }))).status).toBe(400)
    expect((await post(body({ turnstileToken: 'bad' }))).status).toBe(403)
    expect((await post(body({ turnstileToken: undefined }))).status).toBe(403)
    expect(saved).toHaveLength(0)
  })

  it('keeps the lead when email fails', async () => {
    const { post, saved } = setup({ sendEmail: async () => { throw new Error('down') } })
    expect((await post(body())).status).toBe(200)
    expect(saved).toHaveLength(1)
  })
})
