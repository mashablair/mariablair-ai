import { normalizeSyncRecords, syncKey, type SyncRecord } from '../../shared/sheetsSync'
import type { GoogleSheetsSyncSnapshot, SyncSheetCell, SyncSheetTab } from '../googleSheetsSyncReader'

import { GOOGLE_SYNC_FIELD_HEADERS } from './sheetMappingGuard'

const TAB_NAMES = { contacts: 'Contacts', tasks: 'Follow-ups' } as const
const ID_HEADERS = { contacts: 'Contact ID', tasks: 'Task ID' } as const
export class SheetsSyncWriteError extends Error {
  constructor(readonly code: 'configuration' | 'unsupported' | 'stale' | 'unauthorized' | 'uncertain') {
    super(`Google Sheets sync write stopped (${code}).`)
    this.name = 'SheetsSyncWriteError'
  }
}
const fail = (code: ConstructorParameters<typeof SheetsSyncWriteError>[0]): never => { throw new SheetsSyncWriteError(code) }
const safeCell = (cell: SyncSheetCell | undefined): string => {
  if (!cell || cell.formula || cell.hasRichContent || cell.derived || (cell.value !== null && typeof cell.value !== 'string') ||
    ['DATE', 'DATE_TIME', 'TIME'].includes(cell.numberFormatType ?? '')) return fail('unsupported')
  return cell.value ?? ''
}
function columnFor(tab: SyncSheetTab, header: string): number {
  const matches = tab.headers.flatMap((h, i) => h === header ? [i + 1] : [])
  if (matches.length !== 1) return fail('unsupported')
  return matches[0]!
}
const columnName = (column: number) => {
  let name = ''
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}

/**
 * One best-effort request, without automatic retry. Only an explicitly linked existing
 * subset is accepted. Caller owns verified admin auth, distributed locking, fresh reads,
 * durable recovery and a post-write re-read. Sheets values API has no compare-and-swap:
 * this preflight cannot prevent a concurrent human edit between read and write.
 */
export async function writeGoogleSyncChanges(config: {
  spreadsheetId: string
  getAccessToken: () => Promise<string>
  snapshot: GoogleSheetsSyncSnapshot
  expected: SyncRecord[]
  target: SyncRecord[]
  fetch?: typeof fetch
}): Promise<void> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(config.spreadsheetId) || config.snapshot.spreadsheetId !== config.spreadsheetId) fail('configuration')
  let expected: SyncRecord[], target: SyncRecord[]
  try {
    expected = normalizeSyncRecords(config.expected)
    target = normalizeSyncRecords(config.target)
  } catch { return fail('unsupported') }
  const wanted = new Map(target.map((r) => [syncKey(r), r]))
  if (expected.length !== target.length || expected.some((r) => !wanted.has(syncKey(r)))) fail('unsupported')
  const data: { range: string; majorDimension: 'ROWS'; values: string[][] }[] = []
  for (const before of expected) {
    const after = wanted.get(syncKey(before))!
    const mapped = GOOGLE_SYNC_FIELD_HEADERS[before.kind]
    // Non-mapped fields may be carried for the engine but cannot be changed here.
    for (const field of Object.keys(before.fields)) {
      if (!Object.hasOwn(mapped, field) && before.fields[field] !== after.fields[field]) fail('unsupported')
    }
    const matches = config.snapshot.tabs.filter((t) => t.title === TAB_NAMES[before.kind])
    if (matches.length !== 1) fail('unsupported')
    const tab = matches[0]!
    if (new Set(tab.headers.filter(Boolean)).size !== tab.headers.filter(Boolean).length) fail('unsupported')
    const idColumn = columnFor(tab, ID_HEADERS[before.kind])
    // Never silently exclude formula-derived duplicate IDs.
    const rows = tab.rows.filter((r) => r.row > 1 && r.cells.some((c) => c.column === idColumn && c.value === before.id))
    if (rows.length !== 1) fail('unsupported')
    const row = rows[0]!
    const idCell = row.cells.filter((c) => c.column === idColumn)
    if (idCell.length !== 1 || safeCell(idCell[0]) !== before.id || !Number.isInteger(row.row) || row.row < 2 || row.row > tab.rowCount) fail('unsupported')
    for (const [field, header] of Object.entries(mapped)) {
      const column = columnFor(tab, header)
      const cells = row.cells.filter((c) => c.column === column)
      if (cells.length !== 1 || cells[0]!.row !== row.row || column > tab.columnCount) fail('unsupported')
      const current = safeCell(cells[0])
      if (current !== before.fields[field]) fail('stale')
      if (before.fields[field] !== after.fields[field]) {
        data.push({ range: `'${tab.title}'!${columnName(column)}${row.row}`, majorDimension: 'ROWS', values: [[after.fields[field]!]] })
      }
    }
  }
  if (!data.length) return
  const body = JSON.stringify({ valueInputOption: 'RAW', includeValuesInResponse: false, data })
  if (body.length > 1_500_000) fail('unsupported')
  let token: string
  try { token = await config.getAccessToken() } catch { return fail('unauthorized') }
  if (!token || /\s/.test(token)) fail('unauthorized')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const result = await (config.fetch ?? fetch)(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values:batchUpdate`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body,
    })
    if (result.status === 401 || result.status === 403) return fail('unauthorized')
    // All other failures may have applied some state: recovery is read/reconcile, never retry blindly.
    if (!result.ok) return fail('uncertain')
    // Do not read/log provider response bodies. The parent verifies exact cells via a fresh read.
  } catch (error) {
    if (error instanceof SheetsSyncWriteError) throw error
    return fail('uncertain')
  } finally { clearTimeout(timeout) }
}
