import { useState, type FormEvent } from 'react'
import { SESSION_STATUSES, SESSION_TYPES, SESSION_TYPE_LABELS, fullName, type Session, type SessionStatus, type SessionType } from '@shared/types'
import { repo } from '@/data'
import { useList, useWrite } from '@/data/hooks'
import { fromCents, fromLocalInput, orNull, toCents, toLocalInput } from '@/lib/format'
import { Button, Field, Input, Notice, Select } from '@/ui/kit'

export const STATUS_LABELS: Record<SessionStatus, string> = { planned: 'Planned', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' }
// Sensible starting points per session type: minutes and dollars per hour.
const TYPE_DEFAULTS: Record<SessionType, { minutes: string; rate: string }> = {
  consultation: { minutes: '20', rate: '0' }, private: { minutes: '60', rate: '99' }, workshop: { minutes: '120', rate: '' },
}

export function SessionForm({ session, contactId, onSaved, onCancel }: { session?: Session; contactId?: string; onSaved(s: Session): void; onCancel(): void }) {
  const contacts = useList('contacts', { order: { column: 'first_name' } })
  const [f, setF] = useState({
    contact_id: session?.contact_id ?? contactId ?? '', type: (session?.type ?? 'private') as SessionType, status: (session?.status ?? 'scheduled') as SessionStatus,
    title: session?.title ?? '', scheduled_at: toLocalInput(session?.scheduled_at), location: session?.location ?? '',
    minutes: session ? String(session.duration_minutes ?? '') : TYPE_DEFAULTS.private.minutes,
    rate: session ? fromCents(session.agreed_rate_cents) : TYPE_DEFAULTS.private.rate,
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const setType = (e: { target: { value: string } }) => {
    const type = e.target.value as SessionType
    setF((s) => ({ ...s, type, ...(session ? {} : TYPE_DEFAULTS[type]) }))
  }
  const save = useWrite(() => {
    const contact = contacts.data?.find((c) => c.id === f.contact_id)
    const values = {
      contact_id: f.contact_id, company_id: session?.company_id ?? contact?.company_id ?? null, type: f.type, status: f.status, title: orNull(f.title),
      scheduled_at: fromLocalInput(f.scheduled_at), location: orNull(f.location),
      duration_minutes: f.minutes.trim() === '' ? null : Math.max(0, Math.round(Number(f.minutes) || 0)), agreed_rate_cents: toCents(f.rate),
    }
    return session ? repo().update('sessions', session.id, values) : repo().insert('sessions', values)
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onSaved }) }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {!session && !contactId && (
        <div className="sm:col-span-2"><Field label="Client">
          <Select required value={f.contact_id} onChange={set('contact_id')}>
            <option value="">Choose a contact…</option>
            {contacts.data?.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
          </Select>
        </Field></div>
      )}
      <Field label="Type"><Select value={f.type} onChange={setType}>{SESSION_TYPES.map((t) => <option key={t} value={t}>{SESSION_TYPE_LABELS[t]}</option>)}</Select></Field>
      <Field label="Status"><Select value={f.status} onChange={set('status')}>{SESSION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select></Field>
      <div className="sm:col-span-2"><Field label="Title" hint="Optional. For example: Session 2, prompt library."><Input value={f.title} onChange={set('title')} /></Field></div>
      <Field label="Date and time"><Input type="datetime-local" value={f.scheduled_at} onChange={set('scheduled_at')} /></Field>
      <Field label="Location"><Input value={f.location} onChange={set('location')} placeholder="Their office, phone…" /></Field>
      <Field label="Length (minutes)"><Input inputMode="numeric" value={f.minutes} onChange={set('minutes')} /></Field>
      <Field label="Rate ($ per hour)"><Input inputMode="decimal" value={f.rate} onChange={set('rate')} /></Field>
      {save.error && <div className="sm:col-span-2"><Notice tone="danger">{save.error.message}</Notice></div>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{session ? 'Save' : 'Add session'}</Button>
      </div>
    </form>
  )
}
