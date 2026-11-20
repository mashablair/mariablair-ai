import { normalizeSyncRecords, syncKey, type SyncKind, type SyncRecord } from '../../shared/sheetsSync'
import type { GoogleSheetsSyncSnapshot, SyncSheetCell, SyncSheetTab, SyncSheetTitle } from '../googleSheetsSyncReader'
import { SyncError } from './coordinator'

import { GOOGLE_SYNC_FIELD_HEADERS } from './sheetMappingGuard'

export type SyncLink = { kind: SyncKind; id: string; appId: string }
const bad = () => new SyncError('invalid', 'Check linked records, plain-text sync cells and ISO dates in Contacts and Follow-ups. No changes were applied.')
const tabs: Record<SyncKind, SyncSheetTitle> = { contacts: 'Contacts', tasks: 'Follow-ups' }
const idHeaders: Record<SyncKind, string> = { contacts: 'Contact ID', tasks: 'Task ID' }
function plain(cell: SyncSheetCell | undefined) {
  if (!cell || cell.formula || cell.hasRichContent || cell.derived || (cell.value !== null && typeof cell.value !== 'string')) throw bad()
  return cell.value ?? ''
}
const required = (tab: SyncSheetTab, name: string) => {
  const col = tab.headers.indexOf(name) + 1
  if (!col) throw bad()
  return col
}

export function projectGoogleSync(snapshot: GoogleSheetsSyncSnapshot, links: SyncLink[], app: SyncRecord[]) {
  const rows: SyncRecord[] = []
  let unlinkedSheet = 0
  const unmappedColumns = []
  const requested = new Set(links.map(syncKey))
  const apps = new Map(app.map(r => [syncKey(r), r]))
  if (new Set(links.map(r => r.kind + ':' + r.appId)).size !== links.length || requested.size !== links.length || app.length !== links.length) throw bad()
  for (const kind of ['contacts', 'tasks'] as const) {
    const tab = snapshot.tabs.find(t => t.title === tabs[kind])
    if (!tab) throw bad()
    const identity = required(tab, idHeaders[kind])
    const map = Object.entries(GOOGLE_SYNC_FIELD_HEADERS[kind]).map(([field, name]) => [field, required(tab, name)] as const)
    const taskContact = kind === 'tasks' ? required(tab, 'Contact ID') : 0
    unmappedColumns.push({ tab: tab.title, columns: tab.headers.filter((h, i) => h && i + 1 !== identity
      && i + 1 !== taskContact && !map.some(([, col]) => col === i + 1)) })
    const seen = new Set<string>()
    for (const row of tab.rows.filter(r => r.row > 1)) {
      const cell = (column: number) => row.cells.find(c => c.column === column)
      const id = plain(cell(identity))
      if (!id) {
        // Count populated rows missing an ID, but do not derive or assign one.
        if (row.cells.some(c => c.value !== null || c.formula)) unlinkedSheet++
        continue
      }
      if (seen.has(id) || id !== id.trim() || id.length > 100 || /[:\x00-\x1f]/.test(id)) throw bad()
      seen.add(id)
      const key = syncKey({ kind, id })
      if (!requested.has(key)) { unlinkedSheet++; continue }
      const appRow = apps.get(key)
      if (!appRow) throw bad()
      const fields: Record<string, string> = Object.fromEntries(map.map(([field, col]) => [field, plain(cell(col))]))
      if (kind === 'contacts') fields.name = ''
      else {
        if (!fields.title?.trim()) throw bad()
        fields.status = 'open' // deliberately not imported from, or written back to, the Sheet
        fields.contact_id = plain(cell(taskContact))
        if (fields.contact_id !== appRow.fields.contact_id) throw bad()
      }
      rows.push({ kind, id, fields })
    }
  }
  if (rows.length !== links.length || rows.length > 200) throw bad()
  try { return { sheet: normalizeSyncRecords(rows), unlinkedSheet, unmappedColumns } }
  catch { throw bad() }
}
