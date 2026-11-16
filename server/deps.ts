// The outside world, behind one small interface so the API can be tested without network calls.
import { createClient } from '@supabase/supabase-js'
import type { Env } from './app'
import type { Email } from './email'
import type { StripePayment } from './stripe'

export type SavedSubmission = { contact_id: string; submission_id: string; is_new_contact: boolean }
export type SubmitAssessmentArgs = {
  p_contact: { first_name: string; last_name: string; email: string; company: string; business_type: string; ai_needs: string }
  p_version: number; p_definition: unknown; p_track: string; p_answers: unknown; p_score: number; p_level: string
  p_recommendations: { title: string; body: string }[]; p_offer_key: string; p_task_title: string
}

export type RecordStripeEventArgs = { p_event_id: string; p_type: string; p_payload: unknown; p_payment: StripePayment | null }

export type Deps = {
  recordStripeEvent(env: Env, args: RecordStripeEventArgs): Promise<{ status: string }>
  verifyTurnstile(env: Env, token: string, ip: string | undefined): Promise<boolean>
  saveSubmission(env: Env, args: SubmitAssessmentArgs): Promise<SavedSubmission>
  sendEmail(env: Env, email: Email): Promise<void>
}

/** Service-role client: bypasses Row Level Security, so it must never leave the server. */
export const adminClient = (env: Env) =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

export const realDeps: Deps = {
  async verifyTurnstile(env, token, ip) {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token })
    if (ip) body.set('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  },

  async saveSubmission(env, args) {
    const { data, error } = await adminClient(env).rpc('submit_assessment', args)
    if (error) throw new Error(`submit_assessment failed: ${error.message}`)
    return data as SavedSubmission
  },

  async recordStripeEvent(env, args) {
    const { data, error } = await adminClient(env).rpc('record_stripe_event', args)
    if (error) throw new Error(`record_stripe_event failed: ${error.message}`)
    return data as { status: string }
  },

  async sendEmail(env, email) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM, to: [email.to], subject: email.subject, html: email.html, text: email.text,
        reply_to: email.replyTo ?? env.ADMIN_NOTIFY_EMAIL,
      }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
  },
}
