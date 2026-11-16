import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { SESSION_TYPE_LABELS, formatMoney, fullName, type Session } from '@shared/types'
import { useList, useRemove, useRow, useUpdate } from '@/data/hooks'
import { formatDateTime, formatDuration } from '@/lib/format'
import { EditableText } from '@/ui/EditableText'
import { Badge, Button, Empty, Modal, Notice, PageHeader } from '@/ui/kit'
import { Notes } from '../crm/Notes'
import { SessionMaterials } from '../materials/MaterialsPage'
import { Fact, Loaded, Section } from '../crm/shared'
import { STATUS_LABELS, SessionForm } from './SessionForm'

const STATUS_TONES = { planned: 'neutral', scheduled: 'brass', completed: 'ok', cancelled: 'danger' } as const
export const sessionName = (s: Session) => s.title ?? SESSION_TYPE_LABELS[s.type]

export function SessionRow({ session, who }: { session: Session; who?: string }) {
  return (
    <li className="border-b border-line">
      <Link to={`/admin/sessions/${session.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 md:px-2 no-underline hover:bg-sand">
        <span className="min-w-0">
          <span className="font-medium block truncate">{sessionName(session)}{who && <span className="text-muted font-normal"> · {who}</span>}</span>
          <span className="text-sm text-muted block truncate">
            {[session.scheduled_at ? formatDateTime(session.scheduled_at) : 'No date yet', formatDuration(session.duration_minutes), session.location].filter(Boolean).join(' · ')}
          </span>
        </span>
        <Badge tone={STATUS_TONES[session.status]}>{STATUS_LABELS[session.status]}</Badge>
      </Link>
    </li>
  )
}

export function SessionsPage() {
  const sessions = useList('sessions')
  const contacts = useList('contacts')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const names = useMemo(() => new Map(contacts.data?.map((c) => [c.id, fullName(c)])), [contacts.data])
  const { upcoming, past } = useMemo(() => {
    const all = sessions.data ?? []
    const open = all.filter((s) => s.status === 'planned' || s.status === 'scheduled')
      .sort((a, b) => (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999'))
    const closed = all.filter((s) => s.status === 'completed' || s.status === 'cancelled')
      .sort((a, b) => (b.scheduled_at ?? b.created_at).localeCompare(a.scheduled_at ?? a.created_at))
    return { upcoming: open, past: closed }
  }, [sessions.data])
  return (
    <>
      <PageHeader label="Work" title="Sessions" actions={<Button onClick={() => setAdding(true)}>Add session</Button>} />
      <Loaded queries={[sessions, contacts]}>{() => (
        <>
          <Section title="Upcoming and planned">
            {upcoming.length === 0 ? <Empty>Nothing on the calendar.</Empty> : (
              <ul className="list-none p-0 m-0">{upcoming.map((s) => <SessionRow key={s.id} session={s} who={names.get(s.contact_id)} />)}</ul>
            )}
          </Section>
          <Section title="Past">
            {past.length === 0 ? <Empty>No past sessions yet.</Empty> : (
              <ul className="list-none p-0 m-0">{past.map((s) => <SessionRow key={s.id} session={s} who={names.get(s.contact_id)} />)}</ul>
            )}
          </Section>
        </>
      )}</Loaded>
      <Modal title="Add session" open={adding} onClose={() => setAdding(false)}>
        <SessionForm onCancel={() => setAdding(false)} onSaved={(s) => { setAdding(false); navigate(`/admin/sessions/${s.id}`) }} />
      </Modal>
    </>
  )
}

export function SessionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const session = useRow('sessions', id)
  const contact = useRow('contacts', session.data?.contact_id)
  const update = useUpdate('sessions')
  const remove = useRemove('sessions')
  const [editing, setEditing] = useState(false)
  return (
    <Loaded queries={[session]}>{() => {
      const s = session.data
      if (!s) return <Notice>This session no longer exists. <Link className="underline" to="/admin/sessions">Back to sessions</Link></Notice>
      const save = (field: 'plan' | 'outcomes' | 'client_visible_summary') => (value: string | null) => update.mutateAsync({ id: s.id, patch: { [field]: value } })
      const total = s.duration_minutes != null && s.agreed_rate_cents != null ? Math.round((s.duration_minutes / 60) * s.agreed_rate_cents) : null
      return (
        <>
          <p className="mb-2"><Link className="text-sm text-muted underline" to="/admin/sessions">← Sessions</Link></p>
          <PageHeader label={SESSION_TYPE_LABELS[s.type]} title={sessionName(s)} actions={<>
            {s.status !== 'completed' && <Button variant="outline" onClick={() => update.mutate({ id: s.id, patch: { status: 'completed' } })}>Mark completed</Button>}
            <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          </>} />
          <dl className="m-0">
            <Fact label="Client">{contact.data && <Link className="underline" to={`/admin/contacts/${contact.data.id}`}>{fullName(contact.data)}</Link>}</Fact>
            <Fact label="Status"><Badge tone={STATUS_TONES[s.status]}>{STATUS_LABELS[s.status]}</Badge></Fact>
            <Fact label="When">{formatDateTime(s.scheduled_at)}</Fact>
            <Fact label="Where">{s.location}</Fact>
            <Fact label="Length">{formatDuration(s.duration_minutes)}</Fact>
            <Fact label="Rate">{s.agreed_rate_cents != null && `${formatMoney(s.agreed_rate_cents)} per hour`}</Fact>
            <Fact label="Total">{total != null && formatMoney(total)}</Fact>
          </dl>
          <Section title="Plan and outcomes">
            <div className="grid gap-4">
              <EditableText label="Plan" hint="What you intend to cover. Private." value={s.plan} onSave={save('plan')} />
              <EditableText label="Outcomes" hint="What happened and what comes next. Private." value={s.outcomes} onSave={save('outcomes')} />
              <EditableText label="Summary for the client" hint="The client can see this in their account." value={s.client_visible_summary} onSave={save('client_visible_summary')} />
            </div>
          </Section>
          <SessionMaterials session={s} />
          <Notes scope={{ session_id: s.id }} />
          <Section title="Danger zone">
            <Button variant="danger" onClick={() => {
              if (confirm('Delete this session and its notes? This cannot be undone.')) remove.mutate(s.id, { onSuccess: () => navigate('/admin/sessions') })
            }}>Delete session</Button>
          </Section>
          <Modal title="Edit session" open={editing} onClose={() => setEditing(false)}>
            <SessionForm session={s} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
          </Modal>
        </>
      )
    }}</Loaded>
  )
}
