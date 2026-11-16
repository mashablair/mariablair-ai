import type { Context } from 'hono'
import { ASSESSMENT_VERSION, LEVELS, OFFER_RULES, QUESTIONS, RECOMMENDATIONS } from '../shared/assessment'
import { describeAnswers, scoreAssessment, submissionSchema, validateAnswers, type Answers } from '../shared/assessmentEngine'
import type { AppContext } from './app'
import type { Deps } from './deps'
import { adminNotificationEmail, resultsEmail } from './email'

const isLocal = (url: string | undefined) => !url || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)

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

  // Bot check. Skipped only on a local machine with no secret set; anywhere else a missing secret is an error.
  if (env.TURNSTILE_SECRET_KEY) {
    if (!turnstileToken || !(await deps.verifyTurnstile(env, turnstileToken, c.req.header('CF-Connecting-IP')))) {
      return c.json({ error: 'bot_check_failed', message: 'The security check did not pass. Please try again.' }, 403)
    }
  } else if (!isLocal(env.PUBLIC_SITE_URL)) {
    return c.json({ error: 'not_configured' }, 503)
  }

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
      const send = deps.sendEmail(env, note).catch((err) => console.error('admin notification failed', err))
      try { c.executionCtx.waitUntil(send) } catch { await send }
    }
  }
  return c.json({ ok: true, emailed })
}
