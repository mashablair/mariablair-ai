import { describe, expect, it } from 'vitest'
import { previewMappedSheetCells, type GuardedSheetPreview } from '../server/sync/sheetMappingGuard'
import type { GoogleSheetsSyncSnapshot, SyncSheetTab, SyncSheetTitle } from '../server/googleSheetsSyncReader'

function tab(title: SyncSheetTitle, headers: string[], values: string[][]): SyncSheetTab {
  return { title, sheetId: title === 'Contacts' ? 1 : 2, rowCount: 20, columnCount: headers.length, headers,
    rows: [headers, ...values].map((v, i) => ({ row: i + 1, cells: v.map((value, j) => ({ row: i + 1, column: j + 1, value, formatted: value, formula: null })) })) }
}
const fixture = (): GoogleSheetsSyncSnapshot => ({ spreadsheetId: 'fictional_test_sheet', tabs: [
  tab('Contacts', ['Contact ID', 'Name', 'Relationship Type', 'Status', 'First Met / How', 'Next Action', 'Follow-up Due'],
    [['FAKE-C1', 'Alex Example', 'Networking collaborator', 'Met at event; revisit after winter', 'Example event', 'Send introduction', '']]),
  tab('Follow-ups', ['Task ID', 'Contact ID', 'Contact Name', 'Action', 'Priority', 'Due Date', 'Status', 'Last Update / Notes'],
    [['FAKE-F1', 'FAKE-C1', 'Alex Example', 'Review sample deck', 'High', '', 'To review', 'Keep the original context'],
      ['FAKE-F2', 'FAKE-C1', 'Alex Example', 'Draft sample agenda', 'Low', '', 'To do', 'No appointment date agreed']]),
] })
// Applies only an already guarded preview to a fictional snapshot, never to a remote Sheet.
function simulate(snapshot: GoogleSheetsSyncSnapshot, plan: GuardedSheetPreview) {
  const next = structuredClone(snapshot)
  for (const write of plan.writes) {
    const c = next.tabs.find(t => t.title === write.tab)!.rows.find(r => r.row === write.row)!.cells.find(c => c.column === write.column)!
    c.value = write.value; c.formatted = write.value
  }
  return next
}
describe('real-schema lossless mapping guard (fictional records only)', () => {
  it('first and repeat previews/applications preserve rich status, priority, notes, relationship type and blank dates', () => {
    const before = fixture()
    const change = [{ tab: 'Contacts' as const, externalId: 'FAKE-C1', column: 'Next Action', value: 'Prepare a call' },
      { tab: 'Follow-ups' as const, externalId: 'FAKE-F1', column: 'Action', value: 'Review revised sample deck' }]
    const first = previewMappedSheetCells(before, change)
    expect(first.writes).toHaveLength(2)
    expect(first.unmappedColumns).toEqual([
      { tab: 'Contacts', columns: ['Name', 'Relationship Type', 'Status'] },
      { tab: 'Follow-ups', columns: ['Contact ID', 'Contact Name', 'Priority', 'Status', 'Last Update / Notes'] },
    ])
    const after = simulate(before, first)
    const repeat = previewMappedSheetCells(after, change)
    expect(repeat.writes).toEqual([])
    expect(repeat.unmappedColumns).toEqual(first.unmappedColumns)
    expect(simulate(after, repeat)).toEqual(after)
    for (const t of before.tabs) for (const row of t.rows) for (const cell of row.cells) {
      if (first.writes.some(w => w.tab === t.title && w.row === row.row && w.column === cell.column)) continue
      expect(after.tabs.find(x => x.title === t.title)!.rows.find(r => r.row === row.row)!.cells.find(c => c.column === cell.column)).toEqual(cell)
    }
    expect(before).toEqual(fixture())
  })
  it.each([
    ['Contacts', 'Status', 'active_client'], ['Contacts', 'Relationship Type', 'client'],
    ['Follow-ups', 'Status', 'open'], ['Follow-ups', 'Status', 'done'],
    ['Follow-ups', 'Priority', 'normal'], ['Follow-ups', 'Last Update / Notes', ''],
  ] as const)('rejects a lossy or unsupported write to %s %s', (tab, column, value) => {
    const snapshot = fixture()
    expect(() => previewMappedSheetCells(snapshot, [{ tab, externalId: tab === 'Contacts' ? 'FAKE-C1' : 'FAKE-F1', column, value }])).toThrow(/lossless mapping/)
    expect(snapshot).toEqual(fixture())
  })
  it('does not fill blank due dates and rejects guessed/non-ISO dates', () => {
    const snapshot = fixture()
    expect(previewMappedSheetCells(snapshot, []).writes).toEqual([])
    expect(() => previewMappedSheetCells(snapshot, [{ tab: 'Follow-ups', externalId: 'FAKE-F1', column: 'Due Date', value: 'next Tuesday' }])).toThrow(/explicit ISO/)
    expect(previewMappedSheetCells(snapshot, [{ tab: 'Follow-ups', externalId: 'FAKE-F1', column: 'Due Date', value: '' }]).writes).toEqual([])
  })
  it('blocks ambiguous IDs and formulas rather than erasing context', () => {
    const snapshot = fixture(), t = snapshot.tabs[1]!
    t.rows[2]!.cells[0]!.value = 'FAKE-F1'
    const change = [{ tab: 'Follow-ups' as const, externalId: 'FAKE-F1', column: 'Action', value: 'Updated' }]
    expect(() => previewMappedSheetCells(snapshot, change)).toThrow(/Ambiguous/)
    const fresh = fixture(); fresh.tabs[1]!.rows[1]!.cells[3]!.formula = '=A1'
    expect(() => previewMappedSheetCells(fresh, change)).toThrow(/formula/)
  })
})
