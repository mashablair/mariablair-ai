import { describe, expect, it, vi } from 'vitest'
import { writeGoogleSyncChanges } from '../server/sync/googleWriter'
import type { GoogleSheetsSyncSnapshot, SyncSheetTab } from '../server/googleSheetsSyncReader'
import type { SyncRecord } from '../shared/sheetsSync'
const ID = 'synthetic_spreadsheet'
const contact = (fields: Record<string, string> = {}): SyncRecord => ({ kind: 'contacts', id: 'C001', fields: { name: 'Test Contact', source: 'Event', next_action: 'Call', follow_up_date: '2026-11-20', ...fields } })
const task = (fields: Record<string, string> = {}): SyncRecord => ({ kind: 'tasks', id: 'T001', fields: { title: 'Call', contact_id: 'C001', due_date: '2026-11-21', status: 'open', ...fields } })
function tab(title: SyncSheetTab['title'], headers: string[], rows: string[][]): SyncSheetTab {
  return { title, sheetId: title === 'Contacts' ? 1 : 2, rowCount: 20, columnCount: headers.length, headers,
    rows: [headers, [], ...rows].map((r, index) => ({ row: index + 1, cells: headers.map((_, c) => ({ row: index + 1, column: c + 1, value: r[c] ?? null, formula: null, formatted: r[c] ?? null })) })) }
}
function snapshot(): GoogleSheetsSyncSnapshot {
  return { spreadsheetId: ID, tabs: [
    tab('Contacts', ['Contact ID', 'Name', 'First Met / How', 'Next Action', 'Follow-up Due', 'Private note'], [['C001', 'Test Contact', 'Event', 'Call', '2026-11-20', 'Never touch'], ['C002', 'Unlinked', '', '', '', '']]),
    tab('Follow-ups', ['Task ID', 'Contact ID', 'Action', 'Due Date', 'Status'], [['T001', 'C001', 'Call', '2026-11-21', 'Waiting']]),
  ] }
}
function setup() {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
  const config = { spreadsheetId: ID, getAccessToken: vi.fn(async () => 'synthetic-token'), snapshot: snapshot(), expected: [contact(), task()], target: [contact({ next_action: 'Email' }), task({ due_date: '2026-11-22' })], fetch: fetcher }
  return { config, fetcher, run: () => writeGoogleSyncChanges(config) }
}
describe('targeted Google Sheets sync writer (mocked network only)', () => {
  it('writes exactly changed cells by stable ID at physical rows, as RAW, preserving all other cells', async () => {
    const { config, fetcher, run } = setup()
    const original = JSON.stringify(config.snapshot)
    await run()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, req] = fetcher.mock.calls[0]!
    expect(url).toBe(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values:batchUpdate`)
    expect(req.method).toBe('POST')
    expect(req.redirect).toBe('error')
    expect(JSON.parse(req.body)).toEqual({ valueInputOption: 'RAW', includeValuesInResponse: false, data: [
      { range: "'Contacts'!D3", majorDimension: 'ROWS', values: [['Email']] },
      { range: "'Follow-ups'!D3", majorDimension: 'ROWS', values: [['2026-11-22']] },
    ] })
    expect(JSON.stringify(config.snapshot)).toBe(original)
  })
  it('uses RAW even for text beginning with equals and supports deliberate clearing', async () => {
    const { config, fetcher, run } = setup()
    config.target = [contact({ source: '=not_a_formula', follow_up_date: '' }), task()]
    await run()
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).data).toEqual([
      { range: "'Contacts'!C3", majorDimension: 'ROWS', values: [['=not_a_formula']] },
      { range: "'Contacts'!E3", majorDimension: 'ROWS', values: [['']] },
    ])
  })
  it('does nothing and obtains no token when there are no changes', async () => {
    const { config, fetcher, run } = setup(); config.target = config.expected
    await run()
    expect(fetcher).not.toHaveBeenCalled(); expect(config.getAccessToken).not.toHaveBeenCalled()
  })
  it('rejects target changes to unmapped fields, additions, deletions, and unknown fields', async () => {
    for (const target of [[contact({ name: 'Renamed' }), task()], [contact(), task({ status: 'done' })], [contact()], [contact(), task(), { ...contact(), id: 'C003' }], [contact({ internal_notes: 'secret' }), task()]]) {
      const { config, fetcher, run } = setup(); config.target = target
      await expect(run()).rejects.toMatchObject({ code: 'unsupported' }); expect(fetcher).not.toHaveBeenCalled()
    }
  })
  it('fails on stale expected values and never writes an already changed cell', async () => {
    const { config, fetcher, run } = setup(); config.snapshot.tabs[0]!.rows[2]!.cells[3]!.value = 'New human edit'
    await expect(run()).rejects.toMatchObject({ code: 'stale' }); expect(fetcher).not.toHaveBeenCalled()
  })
  it('pins the configured spreadsheet ID and rejects URLs', async () => {
    for (const id of ['other_spreadsheet', 'https://example.com/']) {
      const { config, fetcher, run } = setup(); config.spreadsheetId = id
      await expect(run()).rejects.toMatchObject({ code: 'configuration' }); expect(fetcher).not.toHaveBeenCalled()
    }
  })
  it('rejects formulas, chips, rich text, derived cells and unsupported date shapes in mapped/ID cells', async () => {
    for (const patch of [{ formula: '=A1' }, { hasRichContent: true }, { derived: true }, { value: 45500 }, { numberFormatType: 'DATE' }]) {
      for (const column of [0, 3]) {
        const { config, fetcher, run } = setup(); Object.assign(config.snapshot.tabs[0]!.rows[2]!.cells[column]!, patch)
        await expect(run()).rejects.toMatchObject({ code: 'unsupported' }); expect(fetcher).not.toHaveBeenCalled()
      }
    }
  })
  it('rejects missing/duplicate IDs and formula-derived duplicate IDs', async () => {
    for (const formula of [null, '=A1']) {
      const { config, fetcher, run } = setup()
      Object.assign(config.snapshot.tabs[0]!.rows[3]!.cells[0]!, { value: 'C001', formula })
      await expect(run()).rejects.toMatchObject({ code: 'unsupported' }); expect(fetcher).not.toHaveBeenCalled()
    }
    const { config, run } = setup(); config.snapshot.tabs[0]!.rows[2]!.cells[0]!.value = 'C999'
    await expect(run()).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('rejects duplicate/missing headers, missing cells, invalid coordinates and invalid dates', async () => {
    const mutations = [
      (s: GoogleSheetsSyncSnapshot) => { s.tabs[0]!.headers[5] = 'Next Action' },
      (s: GoogleSheetsSyncSnapshot) => { s.tabs[0]!.headers[3] = 'Unknown' },
      (s: GoogleSheetsSyncSnapshot) => { s.tabs[0]!.rows[2]!.cells.splice(3, 1) },
      (s: GoogleSheetsSyncSnapshot) => { s.tabs[0]!.rows[2]!.row = 99 },
    ]
    for (const mutate of mutations) {
      const { config, fetcher, run } = setup(); mutate(config.snapshot)
      await expect(run()).rejects.toMatchObject({ code: 'unsupported' }); expect(fetcher).not.toHaveBeenCalled()
    }
    const { config, run } = setup(); config.target = [contact({ follow_up_date: '11/20/2026' }), task()]
    await expect(run()).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('redacts all provider/network/token errors and never retries', async () => {
    for (const status of [401, 403, 429, 500]) {
      const { fetcher, run } = setup(); fetcher.mockResolvedValue(new Response('sensitive body', { status }))
      await expect(run()).rejects.toMatchObject({ code: status === 401 || status === 403 ? 'unauthorized' : 'uncertain' })
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
    const { config, fetcher, run } = setup(); fetcher.mockRejectedValue(new Error('secret network detail'))
    await expect(run()).rejects.toMatchObject({ message: 'Google Sheets sync write stopped (uncertain).' }); expect(fetcher).toHaveBeenCalledTimes(1)
    config.getAccessToken.mockRejectedValue(new Error('private token'))
    await expect(run()).rejects.toMatchObject({ message: 'Google Sheets sync write stopped (unauthorized).' }); expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
