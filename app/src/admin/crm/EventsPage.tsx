import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { fullName, type NetworkingEvent } from '@shared/types'
import { repo } from '@/data'
import { useLink, useLinks, useList, useRemove, useRow, useUnlink, useWrite } from '@/data/hooks'
import { formatDate, orNull, today } from '@/lib/format'
import { Button, Empty, Field, Input, Modal, Notice, PageHeader, Select } from '@/ui/kit'
import { ContactForm } from './ContactForm'
import { Fact, Loaded, Section, StageBadge } from './shared'

function EventForm({ event, onSaved, onCancel }: { event?: NetworkingEvent; onSaved(e: NetworkingEvent): void; onCancel(): void }) {
  const [f, setF] = useState({ name: event?.name ?? '', event_date: event?.event_date ?? (event ? '' : today()), location: event?.location ?? '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const save = useWrite(() => {
    const values = { name: f.name.trim(), event_date: orNull(f.event_date), location: orNull(f.location) }
    return event ? repo().update('events', event.id, values) : repo().insert('events', values)
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onSaved }) }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Event name"><Input required autoFocus={!event} value={f.name} onChange={set('name')} placeholder="Boca Chamber breakfast" /></Field></div>
      <Field label="Date"><Input type="date" value={f.event_date} onChange={set('event_date')} /></Field>
      <Field label="Location"><Input value={f.location} onChange={set('location')} /></Field>
      {save.error && <div className="sm:col-span-2"><Notice tone="danger">{save.error.message}</Notice></div>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{event ? 'Save' : 'Add event'}</Button>
      </div>
    </form>
  )
}

export function EventsPage() {
  const events = useList('events', { order: { column: 'event_date', ascending: false } })
  const links = useLinks('contact_events')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of links.data ?? []) m.set(l.event_id, (m.get(l.event_id) ?? 0) + 1)
    return m
  }, [links.data])
  return (
    <>
      <PageHeader label="CRM" title="Events" actions={<Button onClick={() => setAdding(true)}>Add event</Button>} />
      <Loaded queries={[events, links]}>{() => events.data!.length === 0 ? <Empty>No events yet. Add one before your next networking night.</Empty> : (
        <ul className="list-none p-0 m-0 border-t border-line">
          {events.data!.map((e) => (
            <li key={e.id} className="border-b border-line">
              <Link to={`/admin/events/${e.id}`} className="flex items-center justify-between gap-4 py-3 md:px-2 no-underline hover:bg-sand">
                <span className="min-w-0">
                  <span className="font-medium block truncate">{e.name}</span>
                  <span className="text-sm text-muted block truncate">{[formatDate(e.event_date), e.location].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-sm text-muted whitespace-nowrap">{counts.get(e.id) ?? 0} met</span>
              </Link>
            </li>
          ))}
        </ul>
      )}</Loaded>
      <Modal title="Add event" open={adding} onClose={() => setAdding(false)}>
        <EventForm onCancel={() => setAdding(false)} onSaved={(e) => { setAdding(false); navigate(`/admin/events/${e.id}`) }} />
      </Modal>
    </>
  )
}

export function EventPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const event = useRow('events', id)
  const links = useLinks('contact_events', { event_id: id! })
  const contacts = useList('contacts', { order: { column: 'first_name' } })
  const link = useLink('contact_events')
  const unlink = useUnlink('contact_events')
  const remove = useRemove('events')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  return (
    <Loaded queries={[event, links, contacts]}>{() => {
      const e = event.data
      if (!e) return <Notice>This event no longer exists. <Link className="underline" to="/admin/events">Back to events</Link></Notice>
      const metIds = new Set(links.data!.map((l) => l.contact_id))
      const met = contacts.data!.filter((c) => metIds.has(c.id))
      const others = contacts.data!.filter((c) => !metIds.has(c.id))
      return (
        <>
          <p className="mb-2"><Link className="text-sm text-muted underline" to="/admin/events">← Events</Link></p>
          <PageHeader label="Event" title={e.name} actions={<Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>} />
          <dl className="m-0">
            <Fact label="Date">{formatDate(e.event_date)}</Fact>
            <Fact label="Location">{e.location}</Fact>
          </dl>
          <Section title="People you met" actions={<Button onClick={() => setAdding(true)}>Add new person</Button>}>
            {met.length === 0 && <Empty>Nobody linked yet. Add people as you meet them.</Empty>}
            <ul className="list-none p-0 m-0">
              {met.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 border-b border-line">
                  <span className="min-w-0 truncate"><Link className="underline" to={`/admin/contacts/${c.id}`}>{fullName(c)}</Link>{c.business_type && <span className="text-muted">, {c.business_type}</span>}</span>
                  <span className="flex items-center gap-2">
                    <StageBadge stage={c.stage} />
                    <button type="button" aria-label={`Remove ${fullName(c)} from this event`} className="text-muted hover:text-danger px-2 cursor-pointer" onClick={() => unlink.mutate({ contact_id: c.id, event_id: e.id })}>×</button>
                  </span>
                </li>
              ))}
            </ul>
            {others.length > 0 && (
              <Select aria-label="Add an existing contact" className="!w-auto mt-3" value="" onChange={(ev) => ev.target.value && link.mutate({ contact_id: ev.target.value, event_id: e.id })}>
                <option value="">Add someone already in your contacts…</option>
                {others.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
              </Select>
            )}
          </Section>
          <Section title="Danger zone">
            <Button variant="danger" onClick={() => {
              if (confirm(`Delete ${e.name}? The contacts are kept.`)) remove.mutate(e.id, { onSuccess: () => navigate('/admin/events') })
            }}>Delete event</Button>
          </Section>
          <Modal title="Edit event" open={editing} onClose={() => setEditing(false)}>
            <EventForm event={e} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
          </Modal>
          <Modal title={`Met at ${e.name}`} open={adding} onClose={() => setAdding(false)}>
            <ContactForm defaults={{ eventId: e.id, source: e.name }} onCancel={() => setAdding(false)} onSaved={() => setAdding(false)} />
          </Modal>
        </>
      )
    }}</Loaded>
  )
}
