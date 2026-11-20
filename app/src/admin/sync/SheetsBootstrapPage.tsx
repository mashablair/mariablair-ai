import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import { IS_DEMO } from '@/lib/mode'
import { Badge, Button, Card, Field, Input, LinkButton, Notice, PageHeader } from '@/ui/kit'
import { parseSheetsBootstrap, SheetsBootstrapCsvError } from '@shared/sheetsBootstrapCsv'

type Disposition = 'create' | 'linked' | 'blocked'
type Preview = { id?: string; canApply: boolean
  contacts: { id: string; name: string; disposition: Disposition }[]
  tasks: { id: string; title: string; contact_id: string; disposition: Disposition }[] }
type Imported = { id?: string; contactsCreated: number; tasksCreated: number; contactsSkipped: number; tasksSkipped: number }
type ParsedCsv = ReturnType<typeof parseSheetsBootstrap>
const badges = { create: 'New', linked: 'Already linked (unchanged)', blocked: 'Needs review' } as const
const FILE_LIMIT = 400_000

function LiveBootstrap() {
  const { getAccessToken } = useAuth()
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [contacts, setContacts] = useState<File | null>(null)
  const [followUps, setFollowUps] = useState<File | null>(null)
  const [review, setReview] = useState<{ preview: Preview; source: ParsedCsv; token?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Imported | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)

  const request = useCallback(async <T,>(path: string, body?: object, signal?: AbortSignal): Promise<T> => {
    const token = await getAccessToken()
    if (!token) throw new Error('sign_in')
    const response = await fetch('/api/sheets-bootstrap/' + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', signal,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const body = await response.json() as { error?: string }
      throw new Error(body.error ?? 'request_failed')
    }
    return await response.json() as T
  }, [getAccessToken])
  useEffect(() => {
    const controller = new AbortController()
    request<{ enabled: boolean; googleEnabled: boolean }>('status', undefined, controller.signal)
      .then(x => { if (!controller.signal.aborted) { setEnabled(x.enabled); setGoogleEnabled(x.googleEnabled) } })
      .catch(() => { if (!controller.signal.aborted) setError('Could not check import setup. Reload, or sign in again.') })
    return () => controller.abort()
  }, [request])

  const reset = () => { setReview(null); setResult(null); setError(''); setUnconfirmed(false) }

  const preview = async () => {
    if (!contacts || !enabled || busy || unconfirmed) return
    reset(); setBusy(true)
    try {
      if (contacts.size > FILE_LIMIT || (followUps && followUps.size > FILE_LIMIT)) {
        setError('Each CSV file must be smaller than 400 KB.'); return
      }
      let source: ParsedCsv
      try {
        const contactText = await contacts.text()
        const tasksText = followUps ? await followUps.text() : undefined
        source = parseSheetsBootstrap(contactText, tasksText)
      } catch (err) {
        setError(err instanceof SheetsBootstrapCsvError ? err.message : 'Could not read the selected CSVs.')
        return
      }
      // Submit only the explicit projection. Never send original files, contact details or notes.
      const response = await request<Preview>('preview', { contacts: source.contacts, tasks: source.tasks })
      setReview({ preview: response, source })
    } catch { setError('Could not prepare an import preview. Check the approved source setup; no CRM records were changed.') }
    finally { setBusy(false) }
  }

  const previewGoogle = async () => {
    if (!googleEnabled || busy || unconfirmed) return
    reset(); setBusy(true)
    try {
      setReview(await request<{ preview: Preview; source: ParsedCsv; token: string }>('google/preview', {}))
    } catch {
      setError('Could not preview both Google tabs. Check access, required headers, unique stable IDs and plain-text ISO dates. No CRM records were changed. Unsupported cells, duplicate IDs or missing contact references block the whole preview.')
    } finally { setBusy(false) }
  }

  const apply = async () => {
    if (!review?.preview.canApply || busy || !(review.token ? googleEnabled : enabled)) return
    setError(''); setBusy(true)
    try {
      const response = await request<Imported>(review.token ? 'google/apply' : 'apply', review.token ? { token: review.token } : { id: review.preview.id })
      setResult(response); setReview(null); setUnconfirmed(false)
      void queryClient.invalidateQueries()
    } catch (err) {
      if (err instanceof Error && (err.message === 'preview_expired_or_blocked' || err.message === 'preview_stale' || err.message === 'source_changed')) {
        setReview(null); setUnconfirmed(false)
        setError('This preview expired or the source or CRM changed. If an earlier attempt was unconfirmed, check Contacts first; otherwise prepare a fresh preview before importing.')
        return
      }
      // Retrying this *same* preview is idempotent, including when an acknowledgement is lost.
      setUnconfirmed(true)
      setError('The import could not be confirmed. Check this same import again first. If it still won’t finish, review the CRM before starting a fresh preview.')
    } finally { setBusy(false) }
  }

  return <div className="grid gap-4 max-w-4xl">
    {enabled === null && !error && <p role="status">Checking import setup…</p>}
    <Card className="grid gap-3">
      <h2 className="text-2xl">1. New records from Google Sheet</h2>
      <p className="text-muted">Read Contacts and Follow-ups directly from your configured private workbook. No downloads needed. Keep workbook structure unchanged during preview and confirmation. Preview first, then confirm creation. Already-linked rows are shown but left unchanged in this step.</p>
      {!googleEnabled && enabled !== null && <Notice>Direct Google import is not enabled yet. The CRM owner must finish the read-only Google connection setup.</Notice>}
      <div><Button disabled={!googleEnabled || busy || unconfirmed} onClick={() => void previewGoogle()}>Preview new records from Google Sheet</Button></div>
    </Card>
    <Card className="grid gap-3">
      <h2 className="text-2xl">2. Review linked edits separately</h2>
      <p className="text-muted">Creating new records does not apply edits to existing contacts or follow-ups. After creation, open linked edits for a fresh preview and separate confirmation. That step requires linked sync to be enabled. Neither step writes to Google.</p>
      <div><LinkButton to="/admin/sync" variant="outline">Review linked edits</LinkButton></div>
    </Card>
    {error && <Notice tone="danger">{error}</Notice>}
    {result && <Notice tone="ok">Created {result.contactsCreated} contacts and {result.tasksCreated} follow-ups. Left {result.contactsSkipped} already-linked contacts and {result.tasksSkipped} already-linked follow-ups unchanged.</Notice>}
    {enabled && <details>
      <summary className="cursor-pointer underline">CSV fallback: import downloaded exports</summary>
      <Card className="grid gap-3">
        <h2 className="text-2xl">Choose exports from the approved Google Sheet</h2>
        <p className="text-muted">In Google Sheets, download each tab as its own CSV. Choose the Contacts file and optionally its Follow-ups file here. The app cannot verify which workbook a CSV came from. Only choose exports from the approved source. No Google sign-in, automatic sync, or spreadsheet changes.</p>
        <Field label="Contacts CSV (required)"><Input type="file" accept=".csv,text/csv" disabled={busy || unconfirmed}
          onChange={e => { setContacts(e.target.files?.[0] ?? null); reset() }} /></Field>
        <Field label="Follow-ups CSV (optional)"><Input type="file" accept=".csv,text/csv" disabled={busy || unconfirmed}
          onChange={e => { setFollowUps(e.target.files?.[0] ?? null); reset() }} /></Field>
        <div><Button disabled={busy || !contacts || unconfirmed} onClick={() => void preview()}>Preview first import</Button></div>
      </Card>
    </details>}
      {review && <Card className="grid gap-4">
        {review.token && <Notice>Google is re-read on confirmation. If supported values changed, nothing is imported from this preview. Rows blank in all supported columns are ignored; omitted columns are never imported.</Notice>}
        <h2 className="text-2xl">Review before creating CRM records</h2>
        <p className="text-muted">Existing records are never changed. New contacts use the Sheet Name as written and start at New. New follow-ups are open. The original status and notes stay in the Sheet. No messages are sent. Linked edits require step 2.</p>
        {!review.preview.canApply && <Notice>No import can be applied from this preview. Check any rows needing review; existing records are not automatically matched.</Notice>}
        <ul className="grid gap-2">{review.preview.contacts.map(row => {
          const original = review.source.contacts.find(candidate => candidate.id === row.id)
          return <li key={row.id} className="border border-line p-3 break-words">
            <div><Badge tone={row.disposition === 'blocked' ? 'danger' : 'neutral'}>{badges[row.disposition]}</Badge> <strong>{row.name}</strong> <span className="text-muted">{row.id}</span></div>
            {row.disposition === 'create' && original && <p className="text-sm text-muted">Where you met: {original.source || '(blank)'} · Next action: {original.next_action || '(blank)'} · Follow-up due: {original.follow_up_date || '(blank)'}</p>}
          </li>
        })}{review.preview.tasks.map(row => {
          const original = review.source.tasks.find(candidate => candidate.id === row.id)
          return <li key={'task:' + row.id} className="border border-line p-3 break-words">
            <div><Badge tone={row.disposition === 'blocked' ? 'danger' : 'neutral'}>{badges[row.disposition]}</Badge> <strong>{row.title}</strong> <span className="text-muted">{row.id}</span></div>
            <p className="text-sm text-muted">Contact ID: {row.contact_id} · Due: {original?.due_date || '(blank)'}</p>
          </li>
        })}</ul>
        <div className="text-sm text-muted">{(['contacts','tasks'] as const).map(group => review.source.omitted[group].length > 0 &&
          <p key={group}>{group === 'contacts' ? 'Contacts' : 'Follow-ups'} columns not imported: {review.source.omitted[group].join(', ')}.</p>)}</div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !review.preview.canApply} onClick={() => void apply()}>{unconfirmed ? 'Check or retry this import' : 'Confirm and create records'}</Button>
          <Button variant="quiet" disabled={busy} onClick={() => { if (!unconfirmed || window.confirm('Close this import? If its result is uncertain, check Contacts before starting again.')) reset() }}>Close preview</Button>
        </div>
      </Card>}
  </div>
}

export function SheetsBootstrapPage() {
  return <>
    <PageHeader label="Admin tools" title="Sync from Google Sheet" actions={<LinkButton to="/admin/sync" variant="outline">Review linked edits</LinkButton>} />
    {IS_DEMO ? <Notice>Do not select real data in the public demo. First import is only available in the signed-in CRM when enabled.</Notice> : <LiveBootstrap />}
  </>
}
