// Builds the emails. All wording comes from shared/assessment.ts.
import { COPY, OFFERS } from '../shared/assessment'
import { CALL_COPY, type CallRequest } from '../shared/callRequest'
import type { AssessmentResult } from '../shared/assessmentEngine'

export type Email = { to: string; subject: string; html: string; text: string; replyTo?: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// Colors from the marketing page ("Coastal & Upscale").
const INK = '#12324A', MUTED = '#4F6475', SAND = '#F5F1EA', LINE = '#E3DCCF', BRASS = '#7F6236'
const SERIF = `'Cormorant Garamond', 'Iowan Old Style', Georgia, serif`
const SANS = `'Jost', 'Avenir Next', 'Helvetica Neue', Arial, sans-serif`
const label = (t: string) => `<p style="margin:0 0 6px;font:500 12px ${SANS};letter-spacing:0.2em;text-transform:uppercase;color:${BRASS}">${esc(t)}</p>`

export function resultsEmail(to: string, firstName: string, result: AssessmentResult, siteUrl: string): Email {
  const offer = OFFERS[result.offerKey]
  const c = COPY.email
  const online = `${siteUrl.replace(/\/$/, '')}/login`
  const steps = result.recommendations
    .map((r, i) => `<tr><td style="padding:14px 0;border-top:1px solid ${LINE};vertical-align:top;width:34px;font:italic 500 22px ${SERIF};color:${BRASS}">${i + 1}</td>
<td style="padding:14px 0;border-top:1px solid ${LINE}"><p style="margin:0 0 4px;font:500 17px ${SANS};color:${INK}">${esc(r.title)}</p><p style="margin:0;font:400 16px/1.6 ${SANS};color:${MUTED}">${esc(r.body)}</p></td></tr>`)
    .join('')

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:${SAND};padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${LINE}">
<tr><td style="padding:28px 28px 0">
  <p style="margin:0;font:600 26px ${SERIF};color:${INK}">Maria Blair</p>
  <p style="margin:0 0 24px;font:500 11px ${SANS};letter-spacing:0.2em;text-transform:uppercase;color:${BRASS}">AI Consulting</p>
  <p style="margin:0 0 12px;font:400 17px/1.6 ${SANS};color:${INK}">${esc(c.greeting(firstName))}</p>
  <p style="margin:0 0 24px;font:400 17px/1.6 ${SANS};color:${INK}">${esc(c.intro)}</p>
</td></tr>
<tr><td style="padding:24px 28px;background:${INK}">
  <p style="margin:0 0 6px;font:500 12px ${SANS};letter-spacing:0.2em;text-transform:uppercase;color:#D9C29A">${esc(COPY.results.levelLabel)}</p>
  <p style="margin:0 0 10px;font:500 36px/1.1 ${SERIF};color:#F5F1EA">${esc(result.levelName)}</p>
  <p style="margin:0;font:400 16px/1.6 ${SANS};color:#D5DEE3">${esc(result.summary)}</p>
</td></tr>
<tr><td style="padding:28px 28px 8px">
  ${label(COPY.results.stepsTitle)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>
</td></tr>
<tr><td style="padding:8px 28px 28px">
  <div style="background:${SAND};border:1px solid ${LINE};padding:20px">
    ${label(COPY.results.offerLabel)}
    <p style="margin:0 0 2px;font:500 26px ${SERIF};color:${INK}">${esc(offer.name)}</p>
    <p style="margin:0 0 10px;font:400 15px ${SANS};color:${BRASS}">${esc(offer.price)}</p>
    <p style="margin:0 0 16px;font:400 16px/1.6 ${SANS};color:${MUTED}">${esc(offer.body)}</p>
    <a href="${esc(offer.url)}" style="display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;font:500 13px ${SANS};letter-spacing:0.14em;text-transform:uppercase;padding:14px 24px">${esc(offer.cta)}</a>
  </div>
  ${result.note ? `<p style="margin:20px 0 0;font:400 16px/1.6 ${SANS};color:${MUTED}">${esc(result.note)}</p>` : ''}
  <p style="margin:24px 0 0;font:400 16px/1.6 ${SANS};color:${INK}">${esc(c.signoff)}</p>
  <p style="margin:16px 0 0;font:400 16px/1.6 ${SANS};color:${INK}">${esc(c.signature).replace(/\n/g, '<br>')}</p>
  <p style="margin:20px 0 0;font:400 14px ${SANS}"><a href="${esc(online)}" style="color:${MUTED}">${esc(c.viewOnline)}</a></p>
</td></tr>
</table></td></tr></table></body></html>`

  const text = [
    c.greeting(firstName), '', c.intro, '',
    `${COPY.results.levelLabel.toUpperCase()}: ${result.levelName}`, result.summary, '',
    COPY.results.stepsTitle.toUpperCase(),
    ...result.recommendations.map((r, i) => `${i + 1}. ${r.title}\n   ${r.body}`), '',
    `${COPY.results.offerLabel.toUpperCase()}: ${offer.name} (${offer.price})`, offer.body, `${offer.cta}: ${offer.url}`, '',
    ...(result.note ? [result.note, ''] : []),
    c.signoff, '', c.signature, '', `${c.viewOnline}: ${online}`,
  ].join('\n')

  return { to, subject: c.subject(result.levelName), html, text }
}

/** Heads-up to Maria when someone completes the assessment. */
export function adminNotificationEmail(
  to: string, person: { name: string; email: string; company: string }, result: AssessmentResult,
  answers: { question: string; answer: string }[], contactUrl: string,
): Email {
  const lines = [
    `${person.name} <${person.email}>${person.company ? `, ${person.company}` : ''}`,
    `Level: ${result.levelName} (${result.score} of ${result.maxScore})`,
    `Suggested offer: ${OFFERS[result.offerKey].name}`,
    '', ...answers.map((a) => `${a.question}\n  ${a.answer}`), '', `Open in the CRM: ${contactUrl}`,
  ]
  return {
    to, replyTo: person.email, subject: `New assessment: ${person.name} (${result.levelName})`, text: lines.join('\n'),
    html: `<pre style="font:15px/1.6 ${SANS};white-space:pre-wrap">${esc(lines.join('\n'))}</pre>`,
  }
}

/** Sent to the visitor after a free call request. */
export function callConfirmationEmail(to: string, firstName: string, siteUrl: string): Email {
  const c = CALL_COPY.confirmation
  const link = `${siteUrl.replace(/\/$/, '')}/assessment`
  const p = (t: string) => `<p style="margin:0 0 16px;font:400 17px/1.6 ${SANS};color:${INK}">${esc(t)}</p>`
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:${SAND};padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${LINE}">
<tr><td style="padding:28px">
  <p style="margin:0;font:600 26px ${SERIF};color:${INK}">Maria Blair</p>
  <p style="margin:0 0 24px;font:500 11px ${SANS};letter-spacing:0.2em;text-transform:uppercase;color:${BRASS}">AI Consulting</p>
  ${p(c.greeting(firstName))}${p(c.body)}${p(c.meanwhile)}
  <p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;font:500 13px ${SANS};letter-spacing:0.14em;text-transform:uppercase;padding:14px 24px">${esc(c.assessmentLink)}</a></p>
  ${p(c.signoff)}
  <p style="margin:0;font:400 16px/1.6 ${SANS};color:${MUTED}">${esc(c.signature).replace(/\n/g, '<br>')}</p>
</td></tr></table></td></tr></table></body></html>`
  const text = [c.greeting(firstName), '', c.body, '', c.meanwhile, `${c.assessmentLink}: ${link}`, '', c.signoff, '', c.signature].join('\n')
  return { to, subject: c.subject, html, text }
}

/** Heads-up to Maria about a free call request. Replying goes straight to the visitor. */
export function callNotificationEmail(to: string, req: CallRequest, contactUrl: string): Email {
  const lines = [
    `${req.name} <${req.email}>`,
    ...(req.phone ? [`Phone: ${req.phone}`] : []),
    ...(req.company ? [`Business: ${req.company}`] : []),
    '', req.message || '(no message)', '', `Open in the CRM: ${contactUrl}`, 'Reply to this email to answer them directly.',
  ]
  return {
    to, replyTo: req.email, subject: `Free call request: ${req.name}${req.company ? ` (${req.company})` : ''}`, text: lines.join('\n'),
    html: `<pre style="font:15px/1.6 ${SANS};white-space:pre-wrap">${esc(lines.join('\n'))}</pre>`,
  }
}
