import { useCallback, useEffect, useState } from 'react'
import { planSync, resolveSync, type SyncChoice, type SyncInput, type SyncPlan, type SyncRecord } from '@shared/sheetsSync'
import { useAuth } from '@/auth/AuthProvider'
import { IS_DEMO } from '@/lib/mode'
import { Button, Card, Field, Input, Notice, PageHeader, Select } from '@/ui/kit'

const person = (action: string, source = 'Networking event'): SyncRecord => ({ kind: 'contacts', id: 'DEMO-C001', fields: { name: 'Alex Example', source, next_action: action, follow_up_date: '2026-12-01' } })
const task = (title: string): SyncRecord => ({ kind: 'tasks', id: 'DEMO-F001', fields: { title, contact_id: 'DEMO-C001', due_date: '2026-12-02', status: 'open' } })
const example = (): SyncInput => ({
  baseline: [person('Send an introduction'), task('Prepare session outline')],
  sheet: [person('Schedule a call'), task('Prepare session outline')],
  app: [person('Send an introduction', 'Local workshop'), task('Prepare a short session outline')],
})
const direction = { to_app: 'Sheet → app', to_sheet: 'App → Sheet', conflict: 'Choose which value to keep' }

/** Synthetic sandbox, separate from the demo CRM store; no records or credentials leave the browser. */
function SyncSandbox() {
  const [input, setInput] = useState<SyncInput>(example)
  const [preview, setPreview] = useState<{ snapshot: string; plan: SyncPlan } | null>(null)
  const [choices, setChoices] = useState<Record<string, SyncChoice>>({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const previewNow = () => {
    setError(''); setMessage(''); setChoices({})
    try { setPreview({ snapshot: JSON.stringify(input), plan: planSync(input) }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to preview.') }
  }
  const edit = (side: 'sheet' | 'app', index: number, field: string, value: string) => {
    setInput(old => ({ ...old, [side]: old[side].map((r, i) => i === index ? { ...r, fields: { ...r.fields, [field]: value } } : r) }))
    setMessage('')
  }
  const apply = () => {
    setError('')
    if (!preview || preview.snapshot !== JSON.stringify(input)) {
      setError('The sample data changed after preview. Preview again before applying.'); return
    }
    try {
      const result = resolveSync(input, choices)
      const next = structuredClone(input)
      for (const write of result.writes) {
        const row = next[write.side].find(r => r.kind === write.kind && r.id === write.id)
        if (write.create) next[write.side].push({ kind: write.kind, id: write.id, fields: { ...write.fields } })
        else if (row) Object.assign(row.fields, write.fields)
      }
      next.baseline = result.baseline
      setInput(next); setPreview(null); setChoices({})
      setMessage('Sample sync complete. Both sample sides now agree on the reviewed fields. No real records were touched.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not apply.') }
  }
  const unresolved = preview?.plan.changes.some(c => c.direction === 'conflict' && !choices[c.key])
  return <div className="grid gap-5">
    <Notice>This is a development sandbox with fictional records, not your connected Google Sheet. Changes last only until you leave or reload this page.</Notice>
    <div className="grid lg:grid-cols-2 gap-4">
      {(['sheet', 'app'] as const).map(side => <Card key={side}>
        <h2 className="text-2xl mb-4">{side === 'sheet' ? 'Sample Google Sheet' : 'Sample app records'}</h2>
        <div className="grid gap-5">{input[side].map((record, i) => <fieldset key={record.id} className="grid gap-3 border border-line p-3">
          <legend className="text-sm px-2">{record.kind === 'contacts' ? 'Contact' : 'Follow-up'} · {record.id}</legend>
          {Object.entries(record.fields).filter(([field]) => field !== 'contact_id').map(([field, value]) => <Field key={field} label={field.replaceAll('_', ' ')}>
            {field === 'status' ? <Select value={value} onChange={e => edit(side, i, field, e.target.value)}><option value="open">Open</option><option value="done">Done</option></Select>
              : <Input type={field.includes('date') ? 'date' : 'text'} value={value} onChange={e => edit(side, i, field, e.target.value)} />}
          </Field>)}
        </fieldset>)}</div>
      </Card>)}
    </div>
    <div className="flex flex-wrap gap-3">
      <Button onClick={previewNow}>Preview sample sync</Button>
      <Button variant="outline" onClick={() => { setInput(example()); setPreview(null); setChoices({}); setMessage(''); setError('') }}>Reset sample</Button>
      <Button variant="outline" onClick={() => { setInput(old => ({ ...old, sheet: old.sheet.map(r => r.kind === 'contacts' ? { ...r, fields: { ...r.fields, next_action: 'Call Tuesday' } } : r), app: old.app.map(r => r.kind === 'contacts' ? { ...r, fields: { ...r.fields, next_action: 'Email Thursday' } } : r) })); setPreview(null); setChoices({}); setMessage(''); setError('') }}>Try a conflict</Button>
    </div>
    {error && <Notice tone="danger">{error}</Notice>}
    {message && <Notice tone="ok">{message}</Notice>}
    {preview && <Card>
      <h2 className="text-2xl mb-3">Review before applying</h2>
      <p className="text-muted mb-4">{preview.plan.changes.length} field changes · {preview.plan.additions.length} new records · no automatic deletions</p>
      {preview.plan.changes.length === 0 && preview.plan.additions.length === 0 && <p className="mb-3">The sample records are already in sync.</p>}
      <div className="grid gap-3">{preview.plan.changes.map(change => <section key={change.key} className="border border-line p-3">
        <h3 className="font-medium">{change.id}: {change.field.replaceAll('_', ' ')}</h3>
        <p className="text-sm mb-2">{direction[change.direction]}</p>
        <div className="grid sm:grid-cols-2 gap-3 text-sm break-words"><p><b>Sheet:</b> {change.sheetValue || '(blank)'}</p><p><b>App:</b> {change.appValue || '(blank)'}</p></div>
        {change.direction === 'conflict' && <Field label={`Keep for ${change.id} ${change.field.replaceAll('_', ' ')}`}>
          <Select value={choices[change.key] ?? ''} onChange={e => setChoices(old => { const next = { ...old }; if (e.target.value) next[change.key] = e.target.value as SyncChoice; else delete next[change.key]; return next })}>
            <option value="">Choose a value…</option><option value="sheet">Keep Google Sheet value</option><option value="app">Keep app value</option>
          </Select>
        </Field>}
      </section>)}</div>
      {preview.plan.warnings.map(w => <p key={w.key} className="mt-3 text-danger">{w.key}: a previously linked record is missing. It will not be deleted or recreated.</p>)}
      <div className="flex flex-wrap gap-3 mt-4"><Button disabled={unresolved || (preview.plan.changes.length === 0 && preview.plan.additions.length === 0)} onClick={apply}>Apply to sample data only</Button><Button variant="quiet" onClick={() => { setPreview(null); setChoices({}); setError('') }}>Cancel</Button></div>
    </Card>}
  </div>
}
type LiveStatus = { mode: 'off' | 'preview' | 'sheet_to_app'; googleWritesEnabled: false }
type LivePreview = { id: string; expiresAt: number; plan: SyncPlan; coverage?: {
  linked: number; unlinkedApp: number; unlinkedSheet: number; unmappedColumns: { tab: string; columns: string[] }[]
} }
class SyncRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
function LiveSync() {
  const { getAccessToken } = useAuth()
  const [status, setStatus] = useState<LiveStatus | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<LivePreview | null>(null)
  const [choices, setChoices] = useState<Record<string, SyncChoice>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const request = useCallback(async <T,>(path: string, body?: object, signal?: AbortSignal): Promise<T> => {
    const access = await getAccessToken()
    if (!access) throw new SyncRequestError('unauthorized', 'Sign in again to use sync.')
    const res = await fetch('/api/sync/' + path, { method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + access, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store', redirect: 'error', signal, ...(body ? { body: JSON.stringify(body) } : {}) })
    const value = await res.json()
    if (!res.ok) throw new SyncRequestError(value.error, value.message || 'Unable to reach the sync service.')
    return value as T
  }, [getAccessToken])
  useEffect(() => {
    const controller = new AbortController()
    request<LiveStatus>('status', undefined, controller.signal)
      .then(async result => {
        if (controller.signal.aborted) return
        setStatus(result)
        if (result.mode === 'sheet_to_app') {
          const pending = await request<{ previewId: string | null }>('pending', undefined, controller.signal)
          if (!controller.signal.aborted) setPendingId(pending.previewId)
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError('Could not check sync setup. Reload this page before trying again.') })
    return () => controller.abort()
  }, [request])
  const previewNow = async () => {
    if (busy || pendingId || !status || status.mode === 'off') return
    setBusy(true); setError(''); setMessage(''); setPreview(null); setChoices({})
    try { setPreview(await request<LivePreview>('preview', {})) }
    catch (e) { setError(e instanceof SyncRequestError ? e.message : 'Could not load the preview.') }
    finally { setBusy(false) }
  }
  const apply = async (id: string, recovering = false) => {
    if (busy || status?.mode !== 'sheet_to_app') return
    setBusy(true); setError(''); setMessage('')
    try {
      await request('apply', { previewId: id, choices: recovering ? {} : choices })
      setPreview(null); setPendingId(null); setChoices({})
      setMessage(recovering ? 'Sync result verified. You can start a new preview.' : 'Reviewed Sheet changes were applied to the app. The Google Sheet was not changed.')
    } catch (e) {
      const err = e instanceof SyncRequestError ? e : null
      setError(err?.message ?? 'The result could not be confirmed. Check its status before starting another sync.')
      if (!err || err.code === 'needs_review' || err.code === 'sync_failed') {
        // Only the server may designate a preview as recovery-only.
        try {
          const pending = await request<{ previewId: string | null }>('pending')
          setPendingId(pending.previewId)
          if (pending.previewId) setPreview(null)
        } catch { setStatus(null) }
      } else if (err.code === 'stale' || err.code === 'expired') setPreview(null)
    } finally { setBusy(false) }
  }
  const unresolved = preview?.plan.changes.some(change => change.direction === 'conflict' && !choices[change.key])
  const inbound = preview?.plan.changes.filter(change =>
    change.direction === 'to_app' || (change.direction === 'conflict' && choices[change.key] === 'sheet')).length ?? 0
  return <div className="grid gap-4 max-w-4xl">
    {status?.mode === 'off' && <Notice>Google Sheet sync is off. No records will be read or changed through this page. <a className="underline" href="/demo/admin/sync">Try the fictional-data sandbox.</a></Notice>}
    {status?.mode === 'preview' && <Notice>Preview only. You can review linked records, but neither the Sheet nor the app can be updated here.</Notice>}
    {status?.mode === 'sheet_to_app' && <Notice>Sheet → app only. Changes in the app are shown but never written back to Google. Only linked records and supported fields are included. Sync never adds or deletes records.</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
    {message && <Notice tone="ok">{message}</Notice>}
    {!status && !error && <p role="status">Checking sync setup…</p>}
    {pendingId ? <Card><p className="mb-3">A previous sync needs its result checked. This check never repeats the data changes.</p>
      <Button disabled={busy} onClick={() => void apply(pendingId, true)}>Check previous sync</Button></Card>
      : <div><Button disabled={busy || !status || status.mode === 'off'} onClick={() => void previewNow()}>{busy ? 'Working…' : 'Preview Google Sheet sync'}</Button></div>}
    {preview && <Card>
      <h2 className="text-2xl mb-3">Review linked records</h2>
      {preview.coverage && <div className="mb-4 text-sm text-muted">
        <p>{preview.coverage.linked} linked · {preview.coverage.unlinkedSheet} unlinked in Sheet · {preview.coverage.unlinkedApp} unlinked in app. Unlinked records are not synced.</p>
        {preview.coverage.unmappedColumns.map(tab => tab.columns.length > 0 && <p key={tab.tab}>{tab.tab} left unchanged: {tab.columns.join(', ')}.</p>)}
      </div>}
      {preview.plan.changes.length === 0 && <p>No differences in supported fields.</p>}
      <div className="grid gap-3">{preview.plan.changes.map(change => <section key={change.key} className="border border-line p-3">
        <h3 className="font-medium">{change.id}: {change.field.replaceAll('_', ' ')}</h3>
        <p className="text-sm mb-2">{change.direction === 'to_sheet' ? 'App change (not sent to Google)' : direction[change.direction]}</p>
        <div className="grid sm:grid-cols-2 gap-3 text-sm break-words"><p><b>Sheet:</b> {change.sheetValue || '(blank)'}</p><p><b>App:</b> {change.appValue || '(blank)'}</p></div>
        {change.direction === 'conflict' && status?.mode === 'sheet_to_app' && <Field label={'Choose value for ' + change.id + ' ' + change.field.replaceAll('_', ' ')}>
          <Select disabled={busy} value={choices[change.key] ?? ''} onChange={e => {
            const value = e.target.value as SyncChoice | ''
            setChoices(old => { const next = { ...old }; if (value) next[change.key] = value; else delete next[change.key]; return next })
          }}>
            <option value="">Choose a value…</option><option value="sheet">Use the Sheet value in the app</option><option value="app">Leave the app value as is</option>
          </Select>
        </Field>}
      </section>)}</div>
      <div className="flex flex-wrap gap-3 mt-4">
        {status?.mode === 'sheet_to_app' && <Button disabled={busy || unresolved || !inbound} onClick={() => void apply(preview.id)}>Apply {inbound} {inbound === 1 ? 'change' : 'changes'} to app</Button>}
        <Button disabled={busy} variant="quiet" onClick={() => { setPreview(null); setChoices({}); setError('') }}>Close preview</Button>
      </div>
    </Card>}
  </div>
}

export function SheetsSyncPage() {
  return <>
    <PageHeader label="Admin tools" title="Google Sheet sync" />
    <p className="text-muted max-w-3xl mb-5">Review supported changes between Contacts and Follow-ups in your app and Google Sheet.</p>
    {IS_DEMO ? <SyncSandbox /> : <LiveSync />}
  </>
}
