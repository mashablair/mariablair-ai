import { useState, type FormEvent } from 'react'
import type { InternalNote } from '@shared/types'
import { useInsert, useList, useRemove } from '@/data/hooks'
import { formatDate } from '@/lib/format'
import { Button, Empty, Textarea } from '@/ui/kit'
import { Section } from './shared'

type Scope = { contact_id: string } | { company_id: string } | { session_id: string }

/** Private notes. Stored in their own admin-only table; clients can never read them. */
export function Notes({ scope }: { scope: Scope }) {
  const notes = useList('internal_notes', { where: scope as Partial<InternalNote> })
  const add = useInsert('internal_notes')
  const remove = useRemove('internal_notes')
  const [body, setBody] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    add.mutate({ body: body.trim(), ...scope }, { onSuccess: () => setBody('') })
  }
  return (
    <Section title="Private notes">
      <form onSubmit={submit} className="grid gap-2 mb-4">
        <Textarea aria-label="New private note" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Only you can see these." />
        <div><Button type="submit" variant="outline" disabled={add.isPending || !body.trim()}>Add note</Button></div>
      </form>
      {notes.data?.length === 0 && <Empty>No notes yet.</Empty>}
      <ul className="grid gap-3 list-none p-0 m-0">
        {notes.data?.map((n) => (
          <li key={n.id} className="border-l-2 border-brass/50 pl-3">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="text-sm text-muted">
              {formatDate(n.created_at)} · <button type="button" className="underline cursor-pointer" onClick={() => confirm('Delete this note?') && remove.mutate(n.id)}>Delete</button>
            </p>
          </li>
        ))}
      </ul>
    </Section>
  )
}
