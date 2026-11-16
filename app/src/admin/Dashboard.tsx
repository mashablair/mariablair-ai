import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { STAGE_LABELS, fullName, type Stage } from '@shared/types'
import { useList, useUpdate } from '@/data/hooks'
import { addDays, formatDate, today } from '@/lib/format'
import { Button, Empty, Modal, PageHeader, cx } from '@/ui/kit'
import { ContactForm } from './crm/ContactForm'
import { Loaded, Section } from './crm/shared'
import { AddTask, TaskRow } from './crm/Tasks'

const PIPELINE: Stage[] = ['new', 'contacted', 'assessment_completed', 'consultation', 'active_client']

export function Dashboard() {
  const contacts = useList('contacts')
  const tasks = useList('tasks', { where: { done_at: null }, order: { column: 'due_date' } })
  const update = useUpdate('contacts')
  const [adding, setAdding] = useState(false)
  const now = today()
  const soon = addDays(now, 7)

  const followUps = useMemo(
    () => (contacts.data ?? []).filter((c) => c.follow_up_date && c.follow_up_date <= soon).sort((a, b) => a.follow_up_date!.localeCompare(b.follow_up_date!)),
    [contacts.data, soon],
  )
  const byId = useMemo(() => new Map(contacts.data?.map((c) => [c.id, c])), [contacts.data])
  const dueCount = followUps.filter((c) => c.follow_up_date! <= now).length + (tasks.data ?? []).filter((t) => t.due_date && t.due_date <= now).length

  return (
    <>
      <PageHeader label={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} title="Today"
        actions={<Button onClick={() => setAdding(true)}>Add contact</Button>} />
      <Loaded queries={[contacts, tasks]}>{() => (
        <>
          <p className="text-muted">{dueCount === 0 ? 'Nothing is due today.' : `${dueCount} ${dueCount === 1 ? 'thing is' : 'things are'} due.`}</p>

          <Section title="Follow-ups due">
            {followUps.length === 0 && <Empty>No follow-ups in the next 7 days.</Empty>}
            <ul className="list-none p-0 m-0">
              {followUps.map((c) => {
                const overdue = c.follow_up_date! < now
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 border-b border-line">
                    <div className="min-w-0">
                      <Link className="font-medium underline" to={`/admin/contacts/${c.id}`}>{fullName(c)}</Link>
                      <p className="text-[15px]">{c.next_action ?? 'Follow up'}</p>
                      <p className={cx('text-sm', overdue ? 'text-danger font-medium' : 'text-muted')}>
                        {overdue ? 'Overdue: ' : c.follow_up_date === now ? 'Today: ' : ''}{formatDate(c.follow_up_date)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => update.mutate({ id: c.id, patch: { follow_up_date: addDays(now, 7) } })}>+1 week</Button>
                      <Button variant="outline" onClick={() => update.mutate({ id: c.id, patch: { next_action: null, follow_up_date: null } })}>Done</Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section title="Open tasks">
            <AddTask />
            {tasks.data!.length === 0 && <Empty>No open tasks.</Empty>}
            <ul className="list-none p-0 m-0">
              {tasks.data!.map((t) => <TaskRow key={t.id} task={t} contact={t.contact_id ? byId.get(t.contact_id) : undefined} />)}
            </ul>
          </Section>

          <Section title="Pipeline">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {PIPELINE.map((s) => (
                <div key={s} className="border border-line p-3">
                  <p className="font-display text-4xl leading-none">{contacts.data!.filter((c) => c.stage === s).length}</p>
                  <p className="text-sm text-muted mt-1">{STAGE_LABELS[s]}</p>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}</Loaded>
      <Modal title="Add contact" open={adding} onClose={() => setAdding(false)}>
        <ContactForm onCancel={() => setAdding(false)} onSaved={() => setAdding(false)} />
      </Modal>
    </>
  )
}
