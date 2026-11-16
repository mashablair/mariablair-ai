import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { repo } from '@/data'
import { useList, useWrite } from '@/data/hooks'
import { IMPORT_FIELD_LABELS, guessColumns, parseCsv, planImport, type ImportField } from '@/lib/csv'
import { Button, Notice, PageHeader, Select } from '@/ui/kit'

export function ImportContacts() {
  const contacts = useList('contacts')
  const companies = useList('companies')
  const [rows, setRows] = useState<string[][] | null>(null)
  const [columns, setColumns] = useState<(ImportField | null)[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  const header = rows?.[0] ?? []
  const plan = useMemo(
    () => (rows ? planImport(rows.slice(1), columns, (contacts.data ?? []).flatMap((c) => (c.email ? [c.email] : []))) : null),
    [rows, columns, contacts.data],
  )

  const onFile = async (file: File | undefined) => {
    setDone(null)
    setFileError(null)
    if (!file) return
    const parsed = parseCsv(await file.text())
    if (parsed.length < 2) return setFileError('That file has no rows under the header line.')
    setRows(parsed)
    setColumns(guessColumns(parsed[0]!))
  }

  const run = useWrite(async () => {
    const byName = new Map((companies.data ?? []).map((c) => [c.name.toLowerCase(), c.id]))
    let count = 0
    for (const r of plan!.ready) {
      let company_id: string | null = null
      if (r.company) {
        const key = r.company.toLowerCase()
        company_id = byName.get(key) ?? (await repo().insert('companies', { name: r.company, business_type: r.business_type })).id
        byName.set(key, company_id)
      }
      const { company: _company, note, ...fields } = r
      const made = await repo().insert('contacts', { ...fields, company_id })
      if (note) await repo().insert('internal_notes', { contact_id: made.id, body: note })
      count++
    }
    return count
  })

  return (
    <>
      <p className="mb-2"><Link className="text-sm text-muted underline" to="/admin/contacts">← Contacts</Link></p>
      <PageHeader label="CRM" title="Import contacts" />
      {done != null ? (
        <div className="grid gap-4 max-w-xl">
          <Notice tone="ok">Imported {done} {done === 1 ? 'contact' : 'contacts'}.</Notice>
          <Link className="underline" to="/admin/contacts">See your contacts</Link>
        </div>
      ) : (
        <div className="grid gap-5">
          <p className="text-muted max-w-2xl">
            Choose a CSV file (exported from Google Contacts, LinkedIn, Outlook or a spreadsheet). The first line must be column names.
            Nothing is saved until you press Import.
          </p>
          <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => onFile(e.target.files?.[0])}
            className="block w-full max-w-md border border-line p-2 file:mr-3 file:border-0 file:bg-btn file:text-btn-ink file:px-3 file:py-2 file:cursor-pointer" />
          {fileError && <Notice tone="danger">{fileError}</Notice>}
          {rows && plan && (
            <>
              <div>
                <h2 className="text-2xl mb-2">Match your columns</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {header.map((h, i) => (
                    <label key={i} className="block border border-line p-2">
                      <span className="block text-sm font-medium truncate">{h || `Column ${i + 1}`}</span>
                      <span className="block text-sm text-muted truncate mb-1">e.g. {rows[1]?.[i] || 'empty'}</span>
                      <Select value={columns[i] ?? ''} onChange={(e) => setColumns((c) => c.map((v, j) => (j === i ? ((e.target.value || null) as ImportField | null) : v)))}>
                        <option value="">Skip this column</option>
                        {(Object.keys(IMPORT_FIELD_LABELS) as ImportField[]).map((f) => <option key={f} value={f}>{IMPORT_FIELD_LABELS[f]}</option>)}
                      </Select>
                    </label>
                  ))}
                </div>
              </div>
              <Notice>
                <b className="font-medium">{plan.ready.length}</b> ready to import
                {plan.skipped.length > 0 && <>, <b className="font-medium">{plan.skipped.length}</b> will be skipped</>}.
                {plan.ready.length > 0 && <> First: {plan.ready.slice(0, 3).map((r) => `${r.first_name} ${r.last_name}`.trim()).join(', ')}{plan.ready.length > 3 && '…'}</>}
              </Notice>
              {plan.skipped.length > 0 && (
                <details>
                  <summary className="cursor-pointer underline">Why rows are skipped</summary>
                  <ul className="text-sm text-muted mt-2">{plan.skipped.map((s) => <li key={s.line}>Line {s.line}: {s.reason}</li>)}</ul>
                </details>
              )}
              {run.error && <Notice tone="danger">Import stopped: {run.error.message}. Rows before the error were saved; importing again will skip them.</Notice>}
              <div><Button disabled={run.isPending || plan.ready.length === 0} onClick={() => run.mutate(undefined, { onSuccess: setDone })}>
                {run.isPending ? 'Importing…' : `Import ${plan.ready.length} ${plan.ready.length === 1 ? 'contact' : 'contacts'}`}
              </Button></div>
            </>
          )}
        </div>
      )}
    </>
  )
}
