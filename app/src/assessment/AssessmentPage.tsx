import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { COPY } from '@shared/assessment'
import { questionsFor, trackOf, type Answers, type AssessmentResult } from '@shared/assessmentEngine'
import type { Question } from '@shared/assessment'
import { useAuth } from '@/auth/AuthProvider'
import { EmailSignIn } from '@/auth/EmailSignIn'
import { submitAssessment } from '@/data/assessmentApi'
import { IS_CONFIGURED, IS_DEMO } from '@/lib/mode'
import { DemoBar } from '@/ui/DemoBar'
import { Brand, Button, Field, Input, Notice, cx } from '@/ui/kit'
import { ResultsView } from './ResultsView'
import { TURNSTILE_SITE_KEY, Turnstile } from './Turnstile'

type Step = { kind: 'intro' } | { kind: 'question'; index: number } | { kind: 'contact' } | { kind: 'thanks'; email: string; demo?: { result: AssessmentResult; contactId: string } }

const OPTION =
  'w-full text-left min-h-14 px-4 py-3 border bg-bg text-ink cursor-pointer transition-colors flex items-center gap-3 border-line hover:border-brass aria-pressed:border-ink aria-pressed:bg-sand'

function QuestionStep({ q, value, onChange, onNext }: { q: Question; value: string | string[] | undefined; onChange(v: string | string[]): void; onNext(): void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [q.id]) // move screen readers and keyboards to the new question
  const chosen = value === undefined ? [] : Array.isArray(value) ? value : [value]
  const atMax = q.type === 'multi' && q.max != null && chosen.length >= q.max

  const pick = (id: string) => {
    if (q.type === 'single') {
      onChange(id)
      window.setTimeout(onNext, 180) // brief pause so the choice is seen before moving on
      return
    }
    const opt = q.options.find((o) => o.id === id)!
    if (chosen.includes(id)) return onChange(chosen.filter((c) => c !== id))
    if (opt.exclusive) return onChange([id])
    const rest = chosen.filter((c) => !q.options.find((o) => o.id === c)?.exclusive)
    if (q.max != null && rest.length >= q.max) return
    onChange([...rest, id])
  }

  return (
    <div>
      <h1 ref={heading} tabIndex={-1} className="text-3xl md:text-4xl leading-tight mb-2 outline-none">{q.title}</h1>
      {q.help && <p className="text-muted mb-2">{q.help}</p>}
      <div role="group" aria-label={q.title} className="grid gap-2 mt-5">
        {q.options.map((o) => {
          const on = chosen.includes(o.id)
          return (
            <button key={o.id} type="button" aria-pressed={on} disabled={!on && atMax && !o.exclusive} onClick={() => pick(o.id)} className={cx(OPTION, 'disabled:opacity-50 disabled:cursor-not-allowed')}>
              <span aria-hidden className={cx('size-5 shrink-0 border flex items-center justify-center text-xs', q.type === 'single' && 'rounded-full', on ? 'bg-ink border-ink text-bg' : 'border-muted')}>{on && '✓'}</span>
              <span>{o.label}</span>
            </button>
          )
        })}
      </div>
      {q.type === 'multi' && <Button className="mt-5 w-full sm:w-auto" disabled={chosen.length === 0} onClick={onNext}>Continue</Button>}
    </div>
  )
}

export function AssessmentPage() {
  const { state } = useAuth()
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const [answers, setAnswers] = useState<Answers>({})
  const [contact, setContact] = useState({ first_name: '', last_name: '', email: '', company: '' })
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each step starts at the top of the page (matters on phones after a long question).
  const stepKey = step.kind === 'question' ? step.index : step.kind
  useEffect(() => { window.scrollTo(0, 0) }, [stepKey]) // braces matter: scrollTo may return a promise, and an effect must not

  const track = trackOf(answers)
  const questions = useMemo(() => questionsFor(track), [track])
  // Before the first answer the track is unknown; assume a typical length so the bar does not jump much.
  const total = (track ? questions.length : 11) + 1
  const done = step.kind === 'question' ? step.index : step.kind === 'contact' ? total - 1 : step.kind === 'thanks' ? total : 0

  const next = (from: number) => setStep((s) => {
    if (s.kind !== 'question' || s.index !== from) return s
    return from + 1 < questionsFor(trackOf(answersRef.current)).length ? { kind: 'question', index: from + 1 } : { kind: 'contact' }
  })
  const answersRef = useRef(answers)
  answersRef.current = answers

  const back = () => setStep((s) => {
    if (s.kind === 'contact') return { kind: 'question', index: questions.length - 1 }
    if (s.kind === 'question') return s.index === 0 ? { kind: 'intro' } : { kind: 'question', index: s.index - 1 }
    return s
  })

  const setAnswer = (q: Question, v: string | string[]) => setAnswers((a) => {
    // Changing track starts the answers over, so nothing from the other track is sent.
    if (q.id === 'track' && a.track !== v) return { track: v }
    return { ...a, [q.id]: v }
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const outcome = await submitAssessment({ answers, contact, turnstileToken: token ?? undefined })
      setStep({ kind: 'thanks', email: contact.email.trim().toLowerCase(), demo: outcome.demo })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Signed in from the thank-you screen (code typed here): go straight to the results.
  if (step.kind === 'thanks' && !IS_DEMO && state.status === 'signedIn') return <Navigate to="/portal" replace />

  const q = step.kind === 'question' ? questions[step.index] : undefined
  const set = (k: keyof typeof contact) => (e: { target: { value: string } }) => setContact((c) => ({ ...c, [k]: e.target.value }))

  return (
    <div className="min-h-dvh bg-sand flex flex-col">
      <DemoBar />
      <header className="bg-bg border-b border-line">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Brand to={IS_DEMO ? '/demo/admin' : '/'} />
          {step.kind !== 'intro' && step.kind !== 'thanks' && <span className="text-sm text-muted whitespace-nowrap">{done + 1} of {total}</span>}
        </div>
        <div className="h-1 bg-line" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="h-full bg-brass transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-8 md:py-14">
        {step.kind === 'intro' && (
          <div>
            <p className="label-caps mb-2">{COPY.intro.label}</p>
            <h1 className="text-4xl md:text-5xl leading-[1.05] mb-4">{COPY.intro.title}</h1>
            <p className="text-lg text-muted mb-8 max-w-xl">{COPY.intro.body}</p>
            <Button className="w-full sm:w-auto !px-10" onClick={() => setStep({ kind: 'question', index: 0 })}>{COPY.intro.start}</Button>
          </div>
        )}

        {q && step.kind === 'question' && (
          <>
            <QuestionStep key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q, v)} onNext={() => next(step.index)} />
            <div className="mt-6 flex justify-between">
              <Button variant="quiet" onClick={back}>← Back</Button>
              {q.type === 'single' && answers[q.id] !== undefined && <Button variant="quiet" onClick={() => next(step.index)}>Next →</Button>}
            </div>
          </>
        )}

        {step.kind === 'contact' && (
          <form onSubmit={submit} className="grid gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl leading-tight mb-2">{COPY.contact.title}</h1>
              <p className="text-muted">{COPY.contact.body}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={COPY.contact.firstName}><Input required autoFocus autoComplete="given-name" value={contact.first_name} onChange={set('first_name')} /></Field>
              <Field label={COPY.contact.lastName}><Input autoComplete="family-name" value={contact.last_name} onChange={set('last_name')} /></Field>
            </div>
            <Field label={COPY.contact.email}><Input type="email" required inputMode="email" autoComplete="email" value={contact.email} onChange={set('email')} /></Field>
            {track === 'business' && <Field label={COPY.contact.company}><Input autoComplete="organization" value={contact.company} onChange={set('company')} /></Field>}
            <p className="text-sm text-muted">{COPY.contact.consent} <a className="underline" href="/privacy">Privacy policy</a></p>
            <Turnstile onToken={setToken} />
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex flex-wrap-reverse gap-2 justify-between">
              <Button variant="quiet" onClick={back}>← Back</Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={busy || (Boolean(TURNSTILE_SITE_KEY) && !token)}>{busy ? 'Sending…' : COPY.contact.submit}</Button>
            </div>
          </form>
        )}

        {step.kind === 'thanks' && (step.demo ? (
          <div className="grid gap-5">
            <Notice>This is the demo, so no email was sent. On the real site these results arrive by email, and the person can sign in to see them.</Notice>
            <ResultsView data={{ track: step.demo.result.track, level: step.demo.result.level, recommendations: step.demo.result.recommendations, offerKey: step.demo.result.offerKey, note: step.demo.result.note }} />
            <p>The consultant view now has this lead, with a follow-up task: <Link className="underline" to={`/admin/contacts/${step.demo.contactId}`}>open the contact</Link>.</p>
          </div>
        ) : (
          <div className="grid gap-6">
            <div>
              <h1 className="text-4xl leading-tight mb-2">{COPY.thanks.title}</h1>
              <p className="text-lg text-muted">{COPY.thanks.body}</p>
            </div>
            {IS_CONFIGURED && (
              <div className="bg-bg border border-line p-5 grid gap-3">
                <h2 className="text-2xl">{COPY.thanks.accountTitle}</h2>
                <p className="text-muted">{COPY.thanks.accountBody}</p>
                <EmailSignIn fixedEmail={step.email} redirectPath="/portal" sendLabel={COPY.thanks.accountButton} />
              </div>
            )}
            <a className="underline" href="/">Back to the home page</a>
          </div>
        ))}
      </main>
    </div>
  )
}
