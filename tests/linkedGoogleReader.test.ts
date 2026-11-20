import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoogleSheetsSyncReader, type SyncSheetTitle } from '../server/googleSheetsSyncReader'
import { BOOTSTRAP_COLUMNS } from '../server/sync/googleBootstrap'
import { productionCoordinator } from '../server/sync/production'
import { GOOGLE_LINKED_READ_COLUMNS } from '../server/sync/sheetMappingGuard'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../server/deps', () => ({ adminClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('../server/sync/googleAuth', () => ({ createGoogleReadToken: () => async () => 'fictional-token' }))
const spreadsheetId = 'fictional_workbook'
const literal = (stringValue: string) => ({ userEnteredValue: { stringValue }, effectiveValue: { stringValue } })
function fixture(columns: Record<SyncSheetTitle, readonly string[]>, moveColumn = false) {
  const contactHeaders = Array.from({ length: 26 }, (_, i) => `Omitted ${i}`)
  for (const [i, h] of [[0, 'Contact ID'], [1, 'Name'], [3, 'First Met / How'], [12, 'Next Action'], [25, 'Follow-up Due']] as const) contactHeaders[i] = h
  const taskHeaders = Array.from({ length: 12 }, (_, i) => `Omitted ${i}`)
  for (const [i, h] of [[0, 'Task ID'], [1, 'Contact ID'], [5, 'Action'], [11, 'Due Date']] as const) taskHeaders[i] = h
  const tabs = [
    { title: 'Contacts' as const, sheetId: 1, headers: contactHeaders, rowCount: 1000,
      records: [{ 'Contact ID': 'C-1', Name: 'Fictional Person', 'First Met / How': 'Event', 'Next Action': 'Review', 'Follow-up Due': '', 'Omitted 2': 'PRIVATE_CONTACT' },
        { 'Omitted 2': 'PRIVATE_ONLY_ROW' }, { 'Next Action': 'Missing ID' }, { 'Contact ID': 'UNLINKED' }] },
    { title: 'Follow-ups' as const, sheetId: 2, headers: taskHeaders, rowCount: 500,
      records: [{ 'Task ID': 'T-1', 'Contact ID': 'C-1', Action: 'Call', 'Due Date': '', 'Omitted 2': 'PRIVATE_TASK' },
        { 'Omitted 2': 'PRIVATE_ONLY_ROW' }] },
  ]
  const properties = (t: typeof tabs[number]) => ({ title: t.title, sheetId: t.sheetId, sheetType: 'GRID', gridProperties: { rowCount: t.rowCount, columnCount: t.headers.length } })
  const metadata = { spreadsheetId, sheets: [...tabs.map(t => ({ properties: properties(t) })),
    ...Array.from({ length: 4 }, (_, i) => ({ properties: { title: `Other ${i}`, sheetId: i + 3, sheetType: 'GRID', gridProperties: { rowCount: 5000, columnCount: 100 } } }))] }
  const headers = { spreadsheetId, sheets: tabs.map(t => ({ properties: properties(t), data: [{ rowData: [{ values: t.headers.map(literal) }] }] })) }
  const data = { spreadsheetId, sheets: tabs.map(t => ({ properties: properties(t), data: columns[t.title].map(header => ({
    startColumn: t.headers.indexOf(header), rowData: [{ values: [literal(moveColumn && header === 'Next Action' ? 'Private Notes' : header)] },
      ...t.records.map(record => ({ values: header in record ? [literal(moveColumn && header === 'Next Action' ? 'PRIVATE_VALUE_IN_TRANSIT' : (record as Record<string, string>)[header]!)] : [] }))],
  })) })) }
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(metadata)))
    .mockResolvedValueOnce(new Response(JSON.stringify(headers))).mockResolvedValueOnce(new Response(JSON.stringify(data)))
  return { fetcher, tabs }
}
const app = [
  { kind: 'contacts', id: 'C-1', fields: { name: '', source: 'Event', next_action: 'Review', follow_up_date: '' } },
  { kind: 'tasks', id: 'T-1', fields: { contact_id: 'C-1', title: 'Call', due_date: '', status: 'open' } },
]
const env = { SUPABASE_URL: 'https://fictional.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional',
  CRM_SHEETS_SYNC_ID: spreadsheetId, CRM_SHEETS_SYNC_ACCOUNT: 'fictional', CRM_SHEETS_SYNC_KEY: 'fictional', CRM_SHEETS_SYNC_MODE: 'preview' }
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
function setupProduction(moveColumn = false) {
  const f = fixture(GOOGLE_LINKED_READ_COLUMNS, moveColumn)
  vi.stubGlobal('fetch', f.fetcher)
  mocks.rpc.mockImplementation((_name, { p_action }: { p_action: string }) => ({ abortSignal: async () => ({ error: null, data: p_action === 'read'
    ? { app, baseline: app, links: [{ kind: 'contacts', id: 'C-1', appId: 'app-contact' }, { kind: 'tasks', id: 'T-1', appId: 'app-task' }], binding: 'a'.repeat(64), unlinkedApp: 0 }
    : null }) }))
  return f
}
describe('production linked reads and six-tab workbook bounds', () => {
  it('uses only mapping + identity columns, retains omitted names, and does not count omitted-only rows', async () => {
    const f = setupProduction()
    const preview = await productionCoordinator(env)!.preview('fictional-admin')
    expect(preview.coverage).toMatchObject({ linked: 2, unlinkedSheet: 2 }) // missing-ID mapped row + unlinked ID; not the two omitted-only rows
    expect(preview.coverage?.unmappedColumns).toEqual(f.tabs.map(t => ({ tab: t.title, columns: t.headers.filter(h => !GOOGLE_LINKED_READ_COLUMNS[t.title].includes(h)) })))
    expect(JSON.stringify(preview)).not.toMatch(/PRIVATE_|Fictional Person/)
    expect(new URL(f.fetcher.mock.calls[2]![0]).searchParams.getAll('ranges')).toEqual([
      "'Contacts'!A1:A1000", "'Contacts'!D1:D1000", "'Contacts'!M1:M1000", "'Contacts'!Z1:Z1000",
      "'Follow-ups'!A1:A500", "'Follow-ups'!B1:B500", "'Follow-ups'!F1:F500", "'Follow-ups'!L1:L500",
    ])
    for (const [url, options] of f.fetcher.mock.calls) {
      expect(options.method).toBe('GET')
      expect(new URL(url).searchParams.getAll('ranges').some(r => r.includes('Other'))).toBe(false)
    }
    expect(mocks.rpc.mock.calls.map(call => call[1].p_action)).toEqual(['pending', 'read', 'preview_put'])
  })
  it('discards a concurrent column move before preview persistence without logging cells', async () => {
    setupProduction(true)
    const log = vi.spyOn(console, 'error')
    try {
      await expect(productionCoordinator(env)!.preview('fictional-admin')).rejects.toThrow('unsupported_sheet')
      expect(mocks.rpc.mock.calls.map(call => call[1].p_action)).toEqual(['pending', 'read'])
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })
  it('also supports the exact grid sizes and four unrelated tabs for direct-import columns', async () => {
    const f = fixture(BOOTSTRAP_COLUMNS)
    const snapshot = await createGoogleSheetsSyncReader({ spreadsheetId, getAccessToken: async () => 'fictional', fetch: f.fetcher, columns: BOOTSTRAP_COLUMNS }).read()
    expect(snapshot.tabs.map(t => [t.title, t.rowCount, t.columnCount])).toEqual([['Contacts', 1000, 26], ['Follow-ups', 500, 12]])
    expect(snapshot.tabs[0]!.rows[1]!.cells[1]!.value).toBe('Fictional Person')
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_')
    expect(new URL(f.fetcher.mock.calls[2]![0]).searchParams.getAll('ranges')).toContain("'Contacts'!B1:B1000")
  })
})
