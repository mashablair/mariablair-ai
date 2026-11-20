import type { GoogleSheetsSyncSnapshot, SyncSheetCell, SyncSheetTitle } from '../googleSheetsSyncReader'

/** Narrow preflight guard, not a live writer or a complete domain adapter.
 * Rich Sheet statuses are intentionally NOT converted to app stage/open/done.
 */
export const GOOGLE_SYNC_FIELD_HEADERS = {
  contacts: { source: 'First Met / How', next_action: 'Next Action', follow_up_date: 'Follow-up Due' },
  tasks: { title: 'Action', due_date: 'Due Date' },
} as const
// Linked updates need only identities/association and mapped fields, not Name or notes.
export const GOOGLE_LINKED_READ_COLUMNS: Record<SyncSheetTitle, readonly string[]> = {
  Contacts: ['Contact ID', ...Object.values(GOOGLE_SYNC_FIELD_HEADERS.contacts)],
  'Follow-ups': ['Task ID', 'Contact ID', ...Object.values(GOOGLE_SYNC_FIELD_HEADERS.tasks)],
}
const ALLOWED_COLUMNS: Record<SyncSheetTitle, readonly string[]> = {
  Contacts: Object.values(GOOGLE_SYNC_FIELD_HEADERS.contacts),
  'Follow-ups': Object.values(GOOGLE_SYNC_FIELD_HEADERS.tasks),
}
const ID_COLUMN: Record<SyncSheetTitle, string> = { Contacts: 'Contact ID', 'Follow-ups': 'Task ID' }
export type ProposedSheetCell = { tab: SyncSheetTitle; externalId: string; column: string; value: string }
export type GuardedSheetPreview = {
  writes: { tab: SyncSheetTitle; row: number; column: number; before: SyncSheetCell['value']; value: string }[]
  /** Must be shown in a future real preview, not hidden under a successful-sync count. */
  unmappedColumns: { tab: SyncSheetTitle; columns: string[] }[]
}
export function previewMappedSheetCells(snapshot: GoogleSheetsSyncSnapshot, proposed: ProposedSheetCell[]): GuardedSheetPreview {
  const writes: GuardedSheetPreview['writes'] = []
  const seen = new Set<string>()
  for (const change of proposed) {
    if (!Object.hasOwn(ALLOWED_COLUMNS, change.tab) || !ALLOWED_COLUMNS[change.tab].includes(change.column)) {
      throw new Error('Column has no verified lossless mapping. Leave it unchanged and show it as unmapped.')
    }
    if (typeof change.value !== 'string' || change.value.length > 10000 || !change.externalId.trim()) throw new Error('Invalid proposed cell.')
    if (change.column.endsWith('Date') || change.column === 'Follow-up Due') {
      const date = change.value
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Date must be empty or an explicit ISO date; never infer one.')
    }
    const tabs = snapshot.tabs.filter(t => t.title === change.tab)
    if (tabs.length !== 1) throw new Error('Ambiguous or missing tab.')
    const tab = tabs[0]!
    if (new Set(tab.headers.filter(Boolean)).size !== tab.headers.filter(Boolean).length) throw new Error('Duplicate headers.')
    const idCol = tab.headers.indexOf(ID_COLUMN[change.tab]) + 1
    const targetCol = tab.headers.indexOf(change.column) + 1
    if (!idCol || !targetCol) throw new Error('Required header missing.')
    const rows = tab.rows.filter(r => r.row > 1 && r.cells.some(c => c.column === idCol && c.value === change.externalId && !c.formula))
    if (rows.length !== 1) throw new Error('Ambiguous or missing external ID; explicit linking is required.')
    const row = rows[0]!
    const cell = row.cells.find(c => c.column === targetCol)
    if (!cell || cell.formula) throw new Error('Missing or formula cell cannot be overwritten.')
    const key = `${change.tab}:${row.row}:${targetCol}`
    if (seen.has(key)) throw new Error('Duplicate proposed cell.')
    seen.add(key)
    if ((cell.value ?? '') !== change.value) writes.push({ tab: change.tab, row: row.row, column: targetCol, before: cell.value, value: change.value })
  }
  return {
    writes,
    unmappedColumns: snapshot.tabs.map(tab => ({ tab: tab.title, columns: tab.headers.filter(h => h && h !== ID_COLUMN[tab.title] && !ALLOWED_COLUMNS[tab.title].includes(h)) })),
  }
}
