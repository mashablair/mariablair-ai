import { describe, expect, it } from 'vitest'
import { LEVELS, OFFER_RULES, OFFERS, QUESTIONS, RECOMMENDATIONS, TRACK_QUESTION_ID } from '../shared/assessment'
import { describeAnswers, questionsFor, scoreAssessment, submissionSchema, validateAnswers, type Answers } from '../shared/assessmentEngine'

/** Answers every question on a track by picking the option the chooser returns. */
function fill(track: 'business' | 'individual', choose: (ids: string[], qid: string) => string | string[]): Answers {
  const answers: Answers = { [TRACK_QUESTION_ID]: track }
  for (const q of questionsFor(track)) {
    if (q.id === TRACK_QUESTION_ID) continue
    const pick = choose(q.options.map((o) => o.id), q.id)
    answers[q.id] = q.type === 'multi' ? (Array.isArray(pick) ? pick : [pick]) : (pick as string)
  }
  return answers
}
const lowest = (track: 'business' | 'individual') => fill(track, (ids, qid) => {
  const q = QUESTIONS.find((x) => x.id === qid)!
  return [...q.options].sort((a, b) => (a.points ?? 0) - (b.points ?? 0))[0]!.id
})
const highest = (track: 'business' | 'individual') => fill(track, (ids, qid) => {
  const q = QUESTIONS.find((x) => x.id === qid)!
  return [...q.options].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0]!.id
})

describe('assessment content', () => {
  it('has 10 to 12 questions per track, with unique ids', () => {
    for (const track of ['business', 'individual'] as const) {
      const n = questionsFor(track).length
      expect(n, track).toBeGreaterThanOrEqual(10)
      expect(n, track).toBeLessThanOrEqual(12)
    }
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length)
    for (const q of QUESTIONS) expect(new Set(q.options.map((o) => o.id)).size, q.id).toBe(q.options.length)
  })

  it('only uses tags in rules that some answer (or the engine) can produce', () => {
    const produced = new Set(QUESTIONS.flatMap((q) => q.options.flatMap((o) => o.tags ?? [])))
    for (const t of ['track:business', 'track:individual', ...LEVELS.map((l) => `level:${l.key}`)]) produced.add(t)
    for (const r of [...RECOMMENDATIONS, ...OFFER_RULES]) for (const t of r.needs) expect(produced.has(t), `unknown tag "${t}"`).toBe(true)
    for (const r of OFFER_RULES) expect(OFFERS[r.offer]).toBeDefined()
  })

  it('starts with the branching question and branches', () => {
    expect(questionsFor(null).map((q) => q.id)).toEqual([TRACK_QUESTION_ID])
    const b = questionsFor('business').map((q) => q.id)
    const i = questionsFor('individual').map((q) => q.id)
    expect(b.some((id) => id.startsWith('i_'))).toBe(false)
    expect(i.some((id) => id.startsWith('b_'))).toBe(false)
  })
})

describe('scoring', () => {
  it.each(['business', 'individual'] as const)('%s: lowest answers are Curious, highest are Ready to systemize, always 3 steps', (track) => {
    const low = scoreAssessment(lowest(track))
    expect(low).toMatchObject({ track, score: 0, level: 'curious', offerKey: 'free_call' })
    expect(low.recommendations).toHaveLength(3)
    const high = scoreAssessment(highest(track))
    expect(high.score).toBe(high.maxScore)
    expect(high.level).toBe('systemize')
    expect(high.recommendations).toHaveLength(3)
  })

  it('counts the best pick of a multi-choice question, not the sum', () => {
    const a = lowest('business')
    a.b_tools = ['paid_chat', 'copilot', 'free_chat']
    expect(scoreAssessment(a).score).toBe(2)
  })

  it('leads with privacy for businesses with sensitive data', () => {
    const a = lowest('business')
    a.b_data = 'yes'
    expect(scoreAssessment(a).recommendations[0]!.title).toMatch(/privacy/i)
  })

  it('suggests the right offer', () => {
    const team = lowest('business'); team.b_team = 'medium'
    expect(scoreAssessment(team).offerKey).toBe('team_workshop')
    const auto = highest('business'); auto.b_team = 'solo'; auto.b_win = 'automation'
    expect(scoreAssessment(auto).offerKey).toBe('advanced_automation')
    const mid = lowest('individual'); mid.i_use = 'daily'; mid.i_comfort = 'good'
    expect(scoreAssessment(mid)).toMatchObject({ level: 'experimenting', offerKey: 'ai_training_session' })
  })

  it('adds a note for people outside the service area', () => {
    const a = lowest('individual')
    expect(scoreAssessment(a).note).toBeNull()
    a.location = 'elsewhere'
    expect(scoreAssessment(a).note).toMatch(/Palm Beach County/)
  })

  it('describes answers in words', () => {
    const d = describeAnswers(lowest('individual'))
    expect(d[0]).toEqual({ id: 'track', question: 'Which sounds more like you?', answer: "I'm learning AI for myself" })
  })
})

describe('validation', () => {
  it('rejects incomplete, unknown and malformed answers', () => {
    expect(validateAnswers({})).toMatch(/track/)
    const a = lowest('business')
    expect(validateAnswers(a)).toBeNull()
    expect(validateAnswers({ ...a, b_use: undefined as never })).toMatch(/Missing/)
    expect(validateAnswers({ ...a, b_use: 'nope' })).toMatch(/Unknown answer/)
    expect(validateAnswers({ ...a, i_use: 'never' })).toMatch(/Unknown question/)
    expect(validateAnswers({ ...a, b_time: ['email', 'scheduling', 'writing', 'paperwork'] })).toMatch(/Too many/)
    expect(validateAnswers({ ...a, b_tools: ['none', 'copilot'] })).toMatch(/cannot be combined/)
    expect(validateAnswers({ ...a, b_use: ['none'] })).toMatch(/Pick one/)
  })

  it('normalizes the contact and rejects bad emails', () => {
    const ok = submissionSchema.parse({ answers: lowest('business'), contact: { first_name: ' Ana ', email: ' ANA@Example.com ' } })
    expect(ok.contact).toEqual({ first_name: 'Ana', last_name: '', email: 'ana@example.com', company: '' })
    expect(submissionSchema.safeParse({ answers: {}, contact: { first_name: 'A', email: 'nope' } }).success).toBe(false)
    expect(submissionSchema.safeParse({ answers: {}, contact: { first_name: '', email: 'a@b.co' } }).success).toBe(false)
  })
})
