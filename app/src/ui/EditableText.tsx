import { useEffect, useState } from 'react'
import { Field, Textarea } from './kit'

/** A text area that saves when you leave it (if it changed). Shows "Saved" briefly. */
export function EditableText({ label, hint, value, rows = 4, onSave }: { label: string; hint?: string; value: string | null; rows?: number; onSave(value: string | null): Promise<unknown> }) {
  const [text, setText] = useState(value ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  useEffect(() => setText(value ?? ''), [value])
  const save = async () => {
    const next = text.trim() === '' ? null : text.trim()
    if (next === (value ?? null)) return
    setStatus('saving')
    try {
      await onSave(next)
      setStatus('saved')
      window.setTimeout(() => setStatus('idle'), 1500)
    } catch {
      setStatus('error')
    }
  }
  return (
    <Field label={label} hint={status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : hint} error={status === 'error' ? 'Could not save. Try again.' : null}>
      <Textarea rows={rows} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
    </Field>
  )
}
