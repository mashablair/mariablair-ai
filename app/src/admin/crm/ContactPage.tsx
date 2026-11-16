import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { STAGES, STAGE_LABELS, fullName, type Stage } from '@shared/types'
import { useLink, useLinks, useList, useRemove, useRow, useUnlink, useUpdate } from '@/data/hooks'
import { formatDate, today } from '@/lib/format'
import { Button, Empty, Modal, Notice, PageHeader, Select, cx } from '@/ui/kit'
import { ContactForm } from './ContactForm'
import { AssessmentHistory, IntakeSection, RecommendationsSection, SessionsSection } from './ContactSections'
import { ContactMaterials } from '../materials/MaterialsPage'
import { Notes } from './Notes'
import { Fact, Loaded, Section } from './shared'
import { AddTask, TaskRow } from './Tasks'

export function ContactPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const contact = useRow('contacts', id)
  const companies = useList('companies')
  const events = useList('events', { order: { column: 'event_date', ascending: false } })
  const attended = useLinks('contact_events', { contact_id: id! })
  const tasks = useList('tasks', { where: { contact_id: id! }, order: { column: 'due_date' } })
  const update = useUpdate('contacts')
  const remove = useRemove('contacts')
  const linkEvent = useLink('contact_events')
  const unlinkEvent = useUnlink('contact_events')
  const [editing, setEditing] = useState(false)

  return (
    <Loaded queries={[contact, companies, events, attended, tasks]}>{() => {
      const c = contact.data
      if (!c) return <Notice>This contact no longer exists. <Link className="underline" to="/admin/contacts">Back to contacts</Link></Notice>
      const company = companies.data!.find((x) => x.id === c.company_id)
      const attendedIds = new Set(attended.data!.map((a) => a.event_id))
      const due = c.follow_up_date != null && c.follow_up_date <= today()
      return (
        <>
          <p className="mb-2"><Link className="text-sm text-muted underline" to="/admin/contacts">← Contacts</Link></p>
          <PageHeader label={company?.name ?? c.business_type ?? 'Contact'} title={fullName(c)} actions={<Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>} />

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <dl className="m-0">
              <Fact label="Email">{c.email && <a className="underline" href={`mailto:${c.email}`}>{c.email}</a>}</Fact>
              <Fact label="Phone">{c.phone && <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a>}</Fact>
              <Fact label="Company">{company && <Link className="underline" to={`/admin/companies/${company.id}`}>{company.name}</Link>}</Fact>
              <Fact label="Job title">{c.job_title}</Fact>
              <Fact label="Business type">{c.business_type}</Fact>
              <Fact label="Where you met">{c.source}</Fact>
              <Fact label="AI needs">{c.ai_needs && <span className="whitespace-pre-wrap">{c.ai_needs}</span>}</Fact>
              <Fact label="Added">{formatDate(c.created_at)}</Fact>
            </dl>
            <div className="bg-sand border border-line p-4 grid gap-3 content-start">
              <label className="block">
                <span className="label-caps block mb-1">Stage</span>
                <Select value={c.stage} onChange={(e) => update.mutate({ id: c.id, patch: { stage: e.target.value as Stage } })}>
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </Select>
              </label>
              <div>
                <span className="label-caps block mb-1">Next action</span>
                {c.next_action || c.follow_up_date ? (
                  <>
                    <p>{c.next_action ?? 'Follow up'}</p>
                    {c.follow_up_date && <p className={cx('text-sm', due ? 'text-danger font-medium' : 'text-muted')}>{due ? 'Due ' : 'On '}{formatDate(c.follow_up_date)}</p>}
                    <button type="button" className="underline text-sm cursor-pointer mt-1" onClick={() => update.mutate({ id: c.id, patch: { next_action: null, follow_up_date: null } })}>Mark done</button>
                  </>
                ) : <p className="text-muted text-[15px]">Nothing planned. <button type="button" className="underline cursor-pointer" onClick={() => setEditing(true)}>Set one</button></p>}
              </div>
            </div>
          </div>

          <Section title="Tasks">
            <AddTask contactId={c.id} />
            <ul className="list-none p-0 m-0">{tasks.data!.map((t) => <TaskRow key={t.id} task={t} />)}</ul>
          </Section>

          <Notes scope={{ contact_id: c.id }} />

          <SessionsSection contact={c} />
          <AssessmentHistory contact={c} />
          <RecommendationsSection contact={c} />
          <IntakeSection contact={c} />
          <ContactMaterials contact={c} />

          <Section title="Events">
            {attendedIds.size === 0 && <Empty>Not linked to any event.</Empty>}
            <ul className="list-none p-0 m-0 flex flex-wrap gap-2">
              {events.data!.filter((e) => attendedIds.has(e.id)).map((e) => (
                <li key={e.id} className="border border-line px-3 py-1 flex items-center gap-2">
                  <Link className="underline" to={`/admin/events/${e.id}`}>{e.name}</Link>
                  <span className="text-sm text-muted">{formatDate(e.event_date)}</span>
                  <button type="button" aria-label={`Remove from ${e.name}`} className="text-muted hover:text-danger cursor-pointer" onClick={() => unlinkEvent.mutate({ contact_id: c.id, event_id: e.id })}>×</button>
                </li>
              ))}
            </ul>
            {events.data!.some((e) => !attendedIds.has(e.id)) && (
              <Select aria-label="Add to event" className="!w-auto mt-3" value="" onChange={(e) => e.target.value && linkEvent.mutate({ contact_id: c.id, event_id: e.target.value })}>
                <option value="">Add to an event…</option>
                {events.data!.filter((e) => !attendedIds.has(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            )}
          </Section>

          <Section title="Danger zone">
            <Button variant="danger" disabled={remove.isPending} onClick={() => {
              if (confirm(`Delete ${fullName(c)} and everything attached (notes, tasks, sessions)? This cannot be undone.`)) remove.mutate(c.id, { onSuccess: () => navigate('/admin/contacts') })
            }}>Delete contact</Button>
          </Section>

          <Modal title="Edit contact" open={editing} onClose={() => setEditing(false)}>
            <ContactForm contact={c} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
          </Modal>
        </>
      )
    }}</Loaded>
  )
}
