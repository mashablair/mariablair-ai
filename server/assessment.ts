import type { Context } from 'hono'
import { ASSESSMENT_VERSION, LEVELS, OFFER_RULES, QUESTIONS, RECOMMENDATIONS } from '../shared/assessment'
import { describeAnswers, scoreAssessment, submissionSchema, validateAnswers, type Answers } from '../shared/assessmentEngine'
import type { AppContext } from './app'
import type { Deps } from './deps'
import { adminNotificationEmail, resultsEmail, type Email } from './email'

const isLocal = (url: string | undefined) => !url || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)

/**
 * Cloudflare Turnstile check for public forms. Returns a response to send back when the request must stop.
 * Skipped only on a local machine with no secret set; anywhere else a missing secret is an error.
 */
export async function botCheck(c: Context<AppContext>, deps: Deps, token: string | undefined) {
  const env = c.env
  if (env.TURNSTILE_SECRET_KEY) {
    if (!token || !(await deps.verifyTurnstile(env, token, c.req.header('CF-Connecting-IP')))) {
      return c.json({ error: 'bot_check_failed', message: 'The security check did not pass. Please try again.' }, 403)
    }
    return null
  }
  return isLocal(env.PUBLIC_SITE_URL) ? null : c.json({ error: 'not_configured' }, 503)
}

/** Sends an email without letting a failure lose the lead that is already saved. Waits only when there is no request context. */
export function sendInBackground(c: Context<AppContext>, deps: Deps, email: Email, label: string) {
  const send = deps.sendEmail(c.env, email).catch((err) => console.error(`${label} failed`, err))
  try { c.executionCtx.waitUntil(send); return Promise.resolve() } catch { return send }
}

/** POST /api/assessment: validate, bot check, store (contact + submission + task), email the results. */
export async function handleAssessment(c: Context<AppContext>, deps: Deps) {
  const env = c.env
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return c.json({ error: 'not_configured' }, 503)

  const parsed = submissionSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid', message: 'Please check your name and email.' }, 400)
  const { contact, turnstileToken } = parsed.data
  const answers = parsed.data.answers as Answers
  const problem = validateAnswers(answers)
  if (problem) return c.json({ error: 'invalid', message: problem }, 400)

  const blocked = await botCheck(c, deps, turnstileToken)
  if (blocked) return blocked

  const result = scoreAssessment(answers)
  const described = describeAnswers(answers)
  const answerTo = (id: string) => described.find((d) => d.id === id)?.answer ?? ''
  const name = `${contact.first_name} ${contact.last_name}`.trim()

  const saved = await deps.saveSubmission(env, {
    p_contact: {
      ...contact,
      business_type: result.track === 'business' ? answerTo('b_industry') : '',
      ai_needs: result.track === 'business'
        ? `Biggest win: ${answerTo('b_win')}. Time goes to: ${answerTo('b_time')}.`
        : `Wants help with: ${answerTo('i_goals')}. First: ${answerTo('i_first')}.`,
    },
    p_version: ASSESSMENT_VERSION,
    p_definition: { questions: QUESTIONS, levels: LEVELS, recommendations: RECOMMENDATIONS, offerRules: OFFER_RULES },
    p_track: result.track,
    p_answers: answers,
    p_score: result.score,
    p_level: result.level,
    p_recommendations: result.recommendations,
    p_offer_key: result.offerKey,
    p_task_title: `Follow up on assessment: ${name} (${result.levelName})`,
  })

  // The submission is safely stored at this point; an email hiccup must not lose the lead.
  const siteUrl = env.PUBLIC_SITE_URL ?? new URL(c.req.url).origin
  let emailed = false
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    try {
      await deps.sendEmail(env, resultsEmail(contact.email, contact.first_name, result, siteUrl))
      emailed = true
    } catch (err) {
      console.error('results email failed', err)
    }
    if (env.ADMIN_NOTIFY_EMAIL) {
      const note = adminNotificationEmail(env.ADMIN_NOTIFY_EMAIL, { name, email: contact.email, company: contact.company }, result, described,
        `${siteUrl.replace(/\/$/, '')}/admin/contacts/${saved.contact_id}`)
      await sendInBackground(c, deps, note, 'admin notification')
    }
  }
  return c.json({ ok: true, emailed })
}
