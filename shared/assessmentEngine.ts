// Turns answers into a result using the data in assessment.ts. Shared by the app and the API,
// so the browser preview and the stored result can never disagree. No wording lives here.
import { z } from 'zod'
import {
  LEVELS, OFFER_RULES, QUESTIONS, RECOMMENDATIONS, REMOTE_NOTE, TRACK_QUESTION_ID,
  type LevelKey, type OfferKey, type Question, type Track,
} from './assessment'

export type Answers = Record<string, string | string[]>
export type AssessmentResult = {
  track: Track
  score: number
  maxScore: number
  percent: number
  level: LevelKey
  levelName: string
  summary: string
  recommendations: { title: string; body: string }[]
  offerKey: OfferKey
  note: string | null
  tags: string[]
}

export function trackOf(answers: Answers): Track | null {
  const t = answers[TRACK_QUESTION_ID]
  return t === 'business' || t === 'individual' ? t : null
}

/** The questions a person on this track sees, in order. Before a track is chosen: just the first one. */
export function questionsFor(track: Track | null): Question[] {
  return QUESTIONS.filter((q) => q.id === TRACK_QUESTION_ID || (track !== null && (q.track === 'both' || q.track === track)))
}

const picks = (q: Question, answers: Answers): string[] => {
  const a = answers[q.id]
  return a === undefined ? [] : Array.isArray(a) ? a : [a]
}

/** Null when the answers are complete and valid, otherwise what is wrong. */
export function validateAnswers(answers: Answers): string | null {
  const track = trackOf(answers)
  if (!track) return 'Choose a track first'
  const wanted = questionsFor(track)
  const known = new Set(wanted.map((q) => q.id))
  for (const id of Object.keys(answers)) if (!known.has(id)) return `Unknown question: ${id}`
  for (const q of wanted) {
    const a = answers[q.id]
    const chosen = picks(q, answers)
    if (chosen.length === 0) return `Missing answer: ${q.id}`
    if (q.type === 'single' && Array.isArray(a)) return `Pick one answer: ${q.id}`
    if (q.type === 'multi' && !Array.isArray(a)) return `Expected a list: ${q.id}`
    if (new Set(chosen).size !== chosen.length) return `Repeated answer: ${q.id}`
    if (q.max && chosen.length > q.max) return `Too many answers: ${q.id}`
    for (const c of chosen) {
      const opt = q.options.find((o) => o.id === c)
      if (!opt) return `Unknown answer for ${q.id}: ${c}`
      if (opt.exclusive && chosen.length > 1) return `"${opt.label}" cannot be combined: ${q.id}`
    }
  }
  return null
}

export function scoreAssessment(answers: Answers): AssessmentResult {
  const problem = validateAnswers(answers)
  if (problem) throw new Error(problem)
  const track = trackOf(answers)!
  let score = 0
  let maxScore = 0
  const tags = new Set<string>([`track:${track}`])
  for (const q of questionsFor(track)) {
    const chosen = q.options.filter((o) => picks(q, answers).includes(o.id))
    // A question is worth its best option; for "pick several" the best pick counts.
    score += Math.max(0, ...chosen.map((o) => o.points ?? 0))
    maxScore += Math.max(0, ...q.options.map((o) => o.points ?? 0))
    for (const o of chosen) for (const t of o.tags ?? []) tags.add(t)
  }
  const percent = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100)
  const level = LEVELS.find((l) => percent <= l.upTo) ?? LEVELS[LEVELS.length - 1]!
  tags.add(`level:${level.key}`)

  const has = (needs: string[]) => needs.every((t) => tags.has(t))
  return {
    track, score, maxScore, percent,
    level: level.key, levelName: level.name, summary: level.summary[track],
    recommendations: RECOMMENDATIONS.filter((r) => has(r.needs)).slice(0, 3).map(({ title, body }) => ({ title, body })),
    offerKey: OFFER_RULES.find((r) => has(r.needs))!.offer,
    note: tags.has('remote') ? REMOTE_NOTE : null,
    tags: [...tags],
  }
}

/** Question and answer in words, for the CRM and Maria's notification email. */
export function describeAnswers(answers: Answers): { id: string; question: string; answer: string }[] {
  return questionsFor(trackOf(answers)).flatMap((q) => {
    const labels = q.options.filter((o) => picks(q, answers).includes(o.id)).map((o) => o.label)
    return labels.length ? [{ id: q.id, question: q.title, answer: labels.join('; ') }] : []
  })
}

const text = (max: number) => z.string().trim().max(max)
/** What the browser sends to POST /api/assessment. */
export const submissionSchema = z.object({
  answers: z.record(z.string().max(40), z.union([z.string().max(40), z.array(z.string().max(40)).max(12)])),
  contact: z.object({
    first_name: text(80).min(1),
    last_name: text(80).optional().default(''),
    email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
    company: text(120).optional().default(''),
  }),
  turnstileToken: z.string().max(4000).optional(),
})
export type SubmissionInput = z.input<typeof submissionSchema>
export type Submission = z.output<typeof submissionSchema>
