import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { fullName, type Contact, type Task } from '@shared/types'
import { useInsert, useRemove, useUpdate } from '@/data/hooks'
import { formatDate, orNull, today } from '@/lib/format'
import { Button, Input, cx } from '@/ui/kit'

export function TaskRow({ task, contact }: { task: Task; contact?: Contact }) {
  const update = useUpdate('tasks')
  const remove = useRemove('tasks')
  const done = Boolean(task.done_at)
  const overdue = !done && task.due_date != null && task.due_date < today()
  return (
    <li className="flex items-start gap-3 py-2 border-b border-line last:border-0">
      <input
        type="checkbox" className="mt-1.5 size-5 accent-[var(--brass)] cursor-pointer" checked={done} aria-label={`Done: ${task.title}`}
        onChange={() => update.mutate({ id: task.id, patch: { done_at: done ? null : new Date().toISOString() } })}
      />
      <div className="min-w-0 flex-1">
        <p className={cx(done && 'line-through text-muted')}>{task.title}</p>
        <p className="text-sm text-muted">
          {task.due_date && <span className={cx(overdue && 'text-danger font-medium')}>{overdue ? 'Overdue: ' : 'Due '}{formatDate(task.due_date)}</span>}
          {task.due_date && contact && ' · '}
          {contact && <Link className="underline" to={`/admin/contacts/${contact.id}`}>{fullName(contact)}</Link>}
        </p>
      </div>
      <button type="button" aria-label={`Delete task: ${task.title}`} className="text-muted hover:text-danger px-2 cursor-pointer" onClick={() => remove.mutate(task.id)}>×</button>
    </li>
  )
}

export function AddTask({ contactId }: { contactId?: string }) {
  const add = useInsert('tasks')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    add.mutate({ title: title.trim(), due_date: orNull(due), contact_id: contactId ?? null }, { onSuccess: () => { setTitle(''); setDue('') } })
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 mb-2">
      <Input aria-label="New task" className="flex-1 min-w-[180px]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" />
      <Input aria-label="Due date" type="date" className="!w-auto" value={due} onChange={(e) => setDue(e.target.value)} />
      <Button type="submit" variant="outline" disabled={add.isPending || !title.trim()}>Add</Button>
    </form>
  )
}
