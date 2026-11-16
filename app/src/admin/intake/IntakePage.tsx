import { useState, type FormEvent } from 'react'
import { STANDARD_INTAKE } from '@shared/intake'
import type { IntakeQuestion, IntakeResponse, IntakeTemplate } from '@shared/types'
import { repo } from '@/data'
import { useInsert, useList, useRemove, useWrite } from '@/data/hooks'
import { orNull } from '@/lib/format'
import { Badge, Button, Empty, Field, Input, Modal, Notice, PageHeader, Select, Textarea } from '@/ui/kit'
import { Loaded } from '../crm/shared'

const TYPE_LABELS = { text: 'Short answer', long: 'Long answer', choice: 'Pick one' } as const

function TemplateForm({ template, onDone }: { template?: IntakeTemplate; onDone(): void }) {
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [active, setActive] = useState(template?.active ?? true)
  const [questions, setQuestions] = useState<IntakeQuestion[]>(template?.questions ?? [])
  const edit = (i: number, patch: Partial<IntakeQuestion>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const move = (i: number, by: number) => setQuestions((qs) => {
    const next = [...qs]
    const [q] = next.splice(i, 1)
    next.splice(i + by, 0, q!)
    return next
  })
  const save = useWrite(() => {
    const values = { name: name.trim(), description: orNull(description), active, questions: questions.filter((q) => q.label.trim()).map((q) => ({ ...q, label: q.label.trim() })) }
    return template ? repo().update('intake_templates', template.id, values) : repo().insert('intake_templates', values)
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onDone }) }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Form name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid gap-3">
        {questions.map((q, i) => (
          <fieldset key={q.id} className="border border-line p-3 grid gap-2 m-0">
            <legend className="text-sm text-muted px-1">Question {i + 1}</legend>
            <Input aria-label={`Question ${i + 1}`} value={q.label} onChange={(e) => edit(i, { label: e.target.value })} placeholder="Type the question" />
            <div className="flex flex-wrap gap-2 items-center">
              <Select aria-label="Answer type" className="!w-auto" value={q.type} onChange={(e) => edit(i, { type: e.target.value as IntakeQuestion['type'] })}>
                {(Object.keys(TYPE_LABELS) as IntakeQuestion['type'][]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </Select>
              <Button variant="quiet" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</Button>
              <Button variant="quiet" disabled={i === questions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</Button>
              <Button variant="quiet" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            {q.type === 'choice' && (
              <Input aria-label="Choices" value={(q.options ?? []).join(', ')} placeholder="Choices, separated by commas"
                onChange={(e) => edit(i, { options: e.target.value.split(',').map((o) => o.trimStart()) })}
                onBlur={() => edit(i, { options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) })} />
            )}
          </fieldset>
        ))}
        <div><Button variant="outline" onClick={() => setQuestions((qs) => [...qs, { id: crypto.randomUUID().slice(0, 8), label: '', type: 'long' }])}>Add question</Button></div>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" className="size-5 accent-[var(--brass)]" checked={active} onChange={(e) => setActive(e.target.checked)} /> Available for new clients</label>
      {save.error && <Notice tone="danger">{save.error.message}</Notice>}
      <div className="flex gap-2 justify-end">
        <Button variant="quiet" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>Save form</Button>
      </div>
    </form>
  )
}

export function IntakePage() {
  const templates = useList('intake_templates', { order: { column: 'name' } })
  const add = useInsert('intake_templates')
  const remove = useRemove('intake_templates')
  const [editing, setEditing] = useState<IntakeTemplate | 'new' | null>(null)
  return (
    <>
      <PageHeader label="Work" title="Intake forms" actions={<Button onClick={() => setEditing('new')}>New form</Button>} />
      <p className="text-muted mb-4 max-w-2xl">Question lists you fill in with a client before or during a first session. Answers are saved on the client's page.</p>
      <Loaded queries={[templates]}>{() => templates.data!.length === 0 ? (
        <div className="grid gap-3 justify-items-start">
          <Empty>No intake forms yet.</Empty>
          <Button variant="outline" disabled={add.isPending} onClick={() => add.mutate(STANDARD_INTAKE)}>Start with the standard form</Button>
        </div>
      ) : (
        <ul className="list-none p-0 m-0 border-t border-line">
          {templates.data!.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-line">
              <span className="min-w-0">
                <span className="font-medium block">{t.name} {!t.active && <Badge>Hidden</Badge>}</span>
                <span className="text-sm text-muted block">{t.questions.length} questions{t.description && ` · ${t.description}`}</span>
              </span>
              <span className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(t)}>Edit</Button>
                <Button variant="danger" onClick={() => confirm(`Delete "${t.name}"? Answers already saved are kept.`) && remove.mutate(t.id)}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      )}</Loaded>
      <Modal title={editing === 'new' ? 'New intake form' : 'Edit intake form'} open={editing !== null} onClose={() => setEditing(null)}>
        {editing !== null && <TemplateForm key={editing === 'new' ? 'new' : editing.id} template={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  )
}

/** Fill in (or edit) one client's answers to an intake form. */
export function IntakeResponseForm({ template, response, contactId, onDone }: { template: IntakeTemplate; response?: IntakeResponse; contactId: string; onDone(): void }) {
  const [answers, setAnswers] = useState<Record<string, string>>(response?.answers ?? {})
  const set = (id: string) => (e: { target: { value: string } }) => setAnswers((a) => ({ ...a, [id]: e.target.value }))
  const save = useWrite(() => {
    const clean = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''))
    return response ? repo().update('intake_responses', response.id, { answers: clean }) : repo().insert('intake_responses', { contact_id: contactId, template_id: template.id, answers: clean })
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onDone }) }
  return (
    <form onSubmit={submit} className="grid gap-4">
      {template.questions.map((q) => (
        <Field key={q.id} label={q.label} hint={q.help}>
          {q.type === 'long' ? <Textarea value={answers[q.id] ?? ''} onChange={set(q.id)} />
            : q.type === 'choice' ? (
              <Select value={answers[q.id] ?? ''} onChange={set(q.id)}>
                <option value="">Not answered</option>
                {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : <Input value={answers[q.id] ?? ''} onChange={set(q.id)} />}
        </Field>
      ))}
      {save.error && <Notice tone="danger">{save.error.message}</Notice>}
      <div className="flex gap-2 justify-end">
        <Button variant="quiet" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>Save answers</Button>
      </div>
    </form>
  )
}
