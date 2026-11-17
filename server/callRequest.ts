import type { Context } from 'hono'
import { callRequestSchema, splitName } from '../shared/callRequest'
import type { AppContext } from './app'
import { botCheck, sendInBackground } from './assessment'
import type { Deps } from './deps'
import { callConfirmationEmail, callNotificationEmail } from './email'

/** POST /api/call-request: validate, bot check, save the lead (contact + note + task), email both sides. */
export async function handleCallRequest(c: Context<AppContext>, deps: Deps) {
  const env = c.env
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return c.json({ error: 'not_configured' }, 503)

  const parsed = callRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid', message: 'Please check your name and email.' }, 400)
  const req = parsed.data

  const blocked = await botCheck(c, deps, req.turnstileToken)
  if (blocked) return blocked

  const { first_name, last_name } = splitName(req.name)
  const saved = await deps.requestCall(env, {
    p_contact: { first_name, last_name, email: req.email, phone: req.phone, company: req.company },
    p_message: req.message,
    p_task_title: `Reply to free call request: ${req.name}`,
  })

  // The lead is saved at this point; email problems are logged, never shown as a failure.
  const siteUrl = env.PUBLIC_SITE_URL ?? new URL(c.req.url).origin
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    await sendInBackground(c, deps, callConfirmationEmail(req.email, first_name, siteUrl), 'call confirmation')
    if (env.ADMIN_NOTIFY_EMAIL) {
      await sendInBackground(c, deps, callNotificationEmail(env.ADMIN_NOTIFY_EMAIL, req, `${siteUrl.replace(/\/$/, '')}/admin/contacts/${saved.contact_id}`), 'call notification')
    }
  }
  return c.json({ ok: true })
}
