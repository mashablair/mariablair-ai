import { useState, type FormEvent } from 'react'
import { STAGES, STAGE_LABELS, type Contact, type Stage } from '@shared/types'
import { repo } from '@/data'
import { useList, useWrite } from '@/data/hooks'
import { orNull } from '@/lib/format'
import { Button, Field, Input, Notice, Select, Textarea } from '@/ui/kit'

type Props = { contact?: Contact; defaults?: { eventId?: string; source?: string; companyId?: string }; onSaved(contact: Contact): void; onCancel(): void }

/** Add or edit a contact. Short enough to fill in on a phone at a networking event: only the first name is required. */
export function ContactForm({ contact, defaults, onSaved, onCancel }: Props) {
  const companies = useList('companies', { order: { column: 'name' } })
  const events = useList('events', { order: { column: 'event_date', ascending: false } })
  const companyName = (id: string | null | undefined) => companies.data?.find((c) => c.id === id)?.name ?? ''

  const [f, setF] = useState(() => ({
    first_name: contact?.first_name ?? '', last_name: contact?.last_name ?? '', email: contact?.email ?? '', phone: contact?.phone ?? '',
    job_title: contact?.job_title ?? '', business_type: contact?.business_type ?? '', ai_needs: contact?.ai_needs ?? '',
    stage: (contact?.stage ?? 'new') as Stage, source: contact?.source ?? defaults?.source ?? '', next_action: contact?.next_action ?? '',
    follow_up_date: contact?.follow_up_date ?? '', event_id: defaults?.eventId ?? '',
  }))
  // Typed company name; undefined until the user edits it, so the saved name shows once companies load.
  const [company, setCompany] = useState<string | undefined>(undefined)
  const companyValue = company ?? companyName(contact?.company_id ?? defaults?.companyId)
  const set = <K extends keyof typeof f>(k: K) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  const save = useWrite(async () => {
    const name = companyValue.trim()
    let company_id: string | null = null
    if (name) {
      const match = companies.data?.find((c) => c.name.toLowerCase() === name.toLowerCase())
      company_id = match ? match.id : (await repo().insert('companies', { name, business_type: orNull(f.business_type) })).id
    }
    const values = {
      first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: orNull(f.email)?.toLowerCase() ?? null, phone: orNull(f.phone),
      job_title: orNull(f.job_title), business_type: orNull(f.business_type), ai_needs: orNull(f.ai_needs), stage: f.stage,
      source: orNull(f.source) ?? (events.data?.find((e) => e.id === f.event_id)?.name ?? null),
      next_action: orNull(f.next_action), follow_up_date: orNull(f.follow_up_date), company_id,
    }
    const saved = contact ? await repo().update('contacts', contact.id, values) : await repo().insert('contacts', values)
    if (f.event_id) await repo().link('contact_events', { contact_id: saved.id, event_id: f.event_id })
    return saved
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(undefined, { onSuccess: onSaved })
  }
  const error = save.error ? (/contacts_email_key|already exists/.test(save.error.message) ? 'A contact with this email already exists.' : save.error.message) : null

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="First name"><Input required autoFocus={!contact} value={f.first_name} onChange={set('first_name')} autoComplete="off" /></Field>
      <Field label="Last name"><Input value={f.last_name} onChange={set('last_name')} autoComplete="off" /></Field>
      <Field label="Email"><Input type="email" inputMode="email" value={f.email} onChange={set('email')} autoComplete="off" /></Field>
      <Field label="Phone"><Input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="off" /></Field>
      <Field label="Company" hint="Pick one or type a new name.">
        <Input list="company-names" value={companyValue} onChange={(e) => setCompany(e.target.value)} autoComplete="off" />
        <datalist id="company-names">{companies.data?.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      </Field>
      <Field label="Job title"><Input value={f.job_title} onChange={set('job_title')} /></Field>
      <Field label="Business type" hint="For example: dental practice, law office."><Input value={f.business_type} onChange={set('business_type')} /></Field>
      <Field label="Where you met"><Input value={f.source} onChange={set('source')} placeholder="Referral, chamber breakfast…" /></Field>
      {!contact && (
        <Field label="Met at event">
          <Select value={f.event_id} onChange={set('event_id')}>
            <option value="">No event</option>
            {events.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Stage">
        <Select value={f.stage} onChange={set('stage')}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</Select>
      </Field>
      <div className="sm:col-span-2"><Field label="AI needs" hint="What they want help with."><Textarea value={f.ai_needs} onChange={set('ai_needs')} /></Field></div>
      <Field label="Next action"><Input value={f.next_action} onChange={set('next_action')} placeholder="Send intro email" /></Field>
      <Field label="Follow up on"><Input type="date" value={f.follow_up_date} onChange={set('follow_up_date')} /></Field>
      {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : contact ? 'Save' : 'Add contact'}</Button>
      </div>
    </form>
  )
}
