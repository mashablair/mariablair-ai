// The "work" sections of a contact page: sessions, assessment history, recommendations, intake.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { LEVELS, OFFERS, type LevelKey, type OfferKey } from '@shared/assessment'
import { describeAnswers } from '@shared/assessmentEngine'
import type { Contact, IntakeResponse, IntakeTemplate, Recommendation } from '@shared/types'
import { useInsert, useList, useRemove, useUpdate } from '@/data/hooks'
import { formatDate } from '@/lib/format'
import { Badge, Button, Empty, Field, Input, Modal, Select, Textarea } from '@/ui/kit'
import { IntakeResponseForm } from '../intake/IntakePage'
import { SessionForm } from '../sessions/SessionForm'
import { SessionRow } from '../sessions/SessionsPage'
import { Section } from './shared'

export function SessionsSection({ contact }: { contact: Contact }) {
  const sessions = useList('sessions', { where: { contact_id: contact.id }, order: { column: 'scheduled_at', ascending: false } })
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  return (
    <Section title="Sessions" actions={<Button variant="outline" onClick={() => setAdding(true)}>Add session</Button>}>
      {sessions.data?.length === 0 && <Empty>No sessions yet.</Empty>}
      <ul className="list-none p-0 m-0">{sessions.data?.map((s) => <SessionRow key={s.id} session={s} />)}</ul>
      <Modal title="Add session" open={adding} onClose={() => setAdding(false)}>
        <SessionForm contactId={contact.id} onCancel={() => setAdding(false)} onSaved={(s) => { setAdding(false); navigate(`/admin/sessions/${s.id}`) }} />
      </Modal>
    </Section>
  )
}

export function AssessmentHistory({ contact }: { contact: Contact }) {
  const submissions = useList('assessment_submissions', { where: { contact_id: contact.id } })
  if (!submissions.data?.length) return null
  return (
    <Section title="Assessment history">
      <ul className="list-none p-0 m-0 grid gap-2">
        {submissions.data.map((s) => (
          <li key={s.id}>
            <details className="border border-line">
              <summary className="cursor-pointer p-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{LEVELS.find((l) => l.key === (s.level as LevelKey))?.name ?? s.level}</span>
                <Badge>{s.track === 'business' ? 'Business' : 'Individual'}</Badge>
                <span className="text-sm text-muted">Score {s.score} · {formatDate(s.created_at)}</span>
                {s.offer_key && s.offer_key in OFFERS && <span className="text-sm text-muted">· Suggested: {OFFERS[s.offer_key as OfferKey].name}</span>}
              </summary>
              <dl className="m-0 p-3 pt-0 grid gap-2">
                {describeAnswers(s.answers).slice(1).map((a) => (
                  <div key={a.id}><dt className="text-sm text-muted">{a.question}</dt><dd className="m-0">{a.answer}</dd></div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function RecommendationForm({ rec, contactId, nextOrder, onDone }: { rec?: Recommendation; contactId: string; nextOrder: number; onDone(): void }) {
  const add = useInsert('recommendations')
  const update = useUpdate('recommendations')
  const [title, setTitle] = useState(rec?.title ?? '')
  const [body, setBody] = useState(rec?.body ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const values = { title: title.trim(), body: body.trim() }
    if (rec) update.mutate({ id: rec.id, patch: values }, { onSuccess: onDone })
    else add.mutate({ contact_id: contactId, sort_order: nextOrder, ...values }, { onSuccess: onDone })
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Recommendation"><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Details"><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="flex gap-2 justify-end">
        <Button variant="quiet" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={add.isPending || update.isPending}>Save</Button>
      </div>
    </form>
  )
}

export function RecommendationsSection({ contact }: { contact: Contact }) {
  const recs = useList('recommendations', { where: { contact_id: contact.id }, order: { column: 'sort_order' } })
  const update = useUpdate('recommendations')
  const remove = useRemove('recommendations')
  const [editing, setEditing] = useState<Recommendation | 'new' | null>(null)
  const nextOrder = Math.max(0, ...(recs.data ?? []).map((r) => r.sort_order)) + 1
  return (
    <Section title="Recommendations" actions={<Button variant="outline" onClick={() => setEditing('new')}>Add</Button>}>
      <p className="text-sm text-muted mb-2">Started from the assessment. Edit them as you learn more. Only the ones you share appear in the client's account.</p>
      {recs.data?.length === 0 && <Empty>No recommendations yet.</Empty>}
      <ul className="list-none p-0 m-0">
        {recs.data?.map((r) => (
          <li key={r.id} className="py-3 border-b border-line">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium">{r.title}</p>
              <label className="flex items-center gap-2 text-sm whitespace-nowrap cursor-pointer">
                <input type="checkbox" className="size-5 accent-[var(--brass)]" checked={r.shared} onChange={(e) => update.mutate({ id: r.id, patch: { shared: e.target.checked } })} />
                Shared with client
              </label>
            </div>
            {r.body && <p className="text-muted whitespace-pre-wrap">{r.body}</p>}
            <p className="text-sm text-muted mt-1">
              <button type="button" className="underline cursor-pointer" onClick={() => setEditing(r)}>Edit</button> ·{' '}
              <button type="button" className="underline cursor-pointer" onClick={() => confirm('Delete this recommendation?') && remove.mutate(r.id)}>Delete</button>
            </p>
          </li>
        ))}
      </ul>
      <Modal title={editing === 'new' ? 'Add recommendation' : 'Edit recommendation'} open={editing !== null} onClose={() => setEditing(null)}>
        {editing !== null && <RecommendationForm key={editing === 'new' ? 'new' : editing.id} rec={editing === 'new' ? undefined : editing} contactId={contact.id} nextOrder={nextOrder} onDone={() => setEditing(null)} />}
      </Modal>
    </Section>
  )
}

export function IntakeSection({ contact }: { contact: Contact }) {
  const templates = useList('intake_templates', { order: { column: 'name' } })
  const responses = useList('intake_responses', { where: { contact_id: contact.id } })
  const remove = useRemove('intake_responses')
  const [open, setOpen] = useState<{ template: IntakeTemplate; response?: IntakeResponse } | null>(null)
  const byId = new Map(templates.data?.map((t) => [t.id, t]))
  const available = (templates.data ?? []).filter((t) => t.active)
  return (
    <Section title="Intake">
      {responses.data?.length === 0 && <Empty>No intake answers yet.</Empty>}
      <ul className="list-none p-0 m-0 grid gap-2">
        {responses.data?.map((r) => {
          const t = r.template_id ? byId.get(r.template_id) : undefined
          return (
            <li key={r.id}>
              <details className="border border-line">
                <summary className="cursor-pointer p-3"><span className="font-medium">{t?.name ?? 'Intake form (deleted)'}</span> <span className="text-sm text-muted">· {formatDate(r.updated_at)}</span></summary>
                <dl className="m-0 p-3 pt-0 grid gap-2">
                  {(t?.questions ?? Object.keys(r.answers).map((id) => ({ id, label: id }))).filter((q) => r.answers[q.id]).map((q) => (
                    <div key={q.id}><dt className="text-sm text-muted">{q.label}</dt><dd className="m-0 whitespace-pre-wrap">{r.answers[q.id]}</dd></div>
                  ))}
                  <p className="text-sm text-muted">
                    {t && <><button type="button" className="underline cursor-pointer" onClick={() => setOpen({ template: t, response: r })}>Edit answers</button> · </>}
                    <button type="button" className="underline cursor-pointer" onClick={() => confirm('Delete these intake answers?') && remove.mutate(r.id)}>Delete</button>
                  </p>
                </dl>
              </details>
            </li>
          )
        })}
      </ul>
      {available.length > 0 ? (
        <Select aria-label="Fill in an intake form" className="!w-auto mt-3" value="" onChange={(e) => { const t = byId.get(e.target.value); if (t) setOpen({ template: t }) }}>
          <option value="">Fill in an intake form…</option>
          {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      ) : <p className="text-sm text-muted mt-2">Create a form under Intake forms to use it here.</p>}
      <Modal title={open?.template.name ?? ''} open={open !== null} onClose={() => setOpen(null)}>
        {open && <IntakeResponseForm key={open.response?.id ?? open.template.id} template={open.template} response={open.response} contactId={contact.id} onDone={() => setOpen(null)} />}
      </Modal>
    </Section>
  )
}
