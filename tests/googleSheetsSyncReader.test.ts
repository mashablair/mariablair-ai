import { describe, expect, it, vi } from 'vitest'
import { createGoogleSheetsSyncReader } from '../server/googleSheetsSyncReader'
const ID = 'synthetic_spreadsheet'
const properties = (title: string, sheetId: number) => ({ title, sheetId, sheetType: 'GRID', gridProperties: { rowCount: 10, columnCount: 3 } })
const literal = (stringValue: string) => ({ userEnteredValue: { stringValue }, effectiveValue: { stringValue } })
const meta = () => ({ spreadsheetId: ID, sheets: [{ properties: properties('Contacts', 1) }, { properties: properties('Follow-ups', 2) }] })
const data = () => ({ spreadsheetId: ID, sheets: [
  { properties: properties('Contacts', 1), data: [{ rowData: [
    { values: [literal('Contact ID'), literal('Name'), literal('Status')] }, {},
    { values: [literal('C001'), literal('Test Person'), { userEnteredValue: { formulaValue: '=A3' }, effectiveValue: { stringValue: 'C001' }, formattedValue: 'C001' }] },
  ] }] },
  { properties: properties('Follow-ups', 2), data: [{ rowData: [{ values: [literal('Task ID'), literal('Contact ID'), literal('Action')] }, { values: [literal('T001'), literal('C001'), literal('Call')] }] }] },
] })
function setup(m: unknown = meta(), d: unknown = data()) {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(m))).mockResolvedValueOnce(new Response(JSON.stringify(d)))
  return { fetcher, read: createGoogleSheetsSyncReader({ spreadsheetId: ID, getAccessToken: async () => 'synthetic-token', fetch: fetcher }).read }
}
describe('Google Sheets sync read-only adapter', () => {
  it('reads only configured tabs, preserving physical rows, blanks and formulas', async () => {
    const { read, fetcher } = setup()
    const snapshot = await read()
    expect(snapshot.tabs[0]!.rows[1]!.cells.map((c) => c.value)).toEqual([null, null, null])
    expect(snapshot.tabs[0]!.rows[2]!.cells[2]).toEqual({ row: 3, column: 3, value: 'C001', formula: '=A3', formatted: 'C001' })
    for (const [url, options] of fetcher.mock.calls) {
      expect(new URL(url).origin).toBe('https://sheets.googleapis.com')
      expect(new URL(url).pathname).toBe(`/v4/spreadsheets/${ID}`)
      expect(options.method).toBe('GET')
      expect(options.redirect).toBe('error')
    }
    expect(new URL(fetcher.mock.calls[1]![0]).searchParams.getAll('ranges')).toEqual(["'Contacts'!A1:C10", "'Follow-ups'!A1:C10"])
  })
  it('rejects missing tabs before reading any cells', async () => {
    const m = meta(); m.sheets.pop()
    const { read, fetcher } = setup(m)
    await expect(read()).rejects.toMatchObject({ code: 'unsupported_sheet' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects an incorrect spreadsheet response', async () => {
    await expect(setup({ ...meta(), spreadsheetId: 'another_sheet' }).read()).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it('rejects overly large grids rather than silently truncating data', async () => {
    const m = meta(); m.sheets[0]!.properties.gridProperties.rowCount = 1001
    await expect(setup(m).read()).rejects.toMatchObject({ code: 'unsupported_sheet' })
  })
  it('rejects metadata drift between requests', async () => {
    const d = data(); d.sheets[0]!.properties.sheetId = 99
    await expect(setup(meta(), d).read()).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it('rejects malformed cell unions without including their values in errors', async () => {
    const d = data(); Object.assign(d.sheets[0]!.data[0]!.rowData[0]!.values![0]!.userEnteredValue, { boolValue: true })
    await expect(setup(meta(), d).read()).rejects.toMatchObject({ code: 'invalid_response', message: 'Google Sheets preview unavailable (invalid_response).' })
  })
  it('rejects duplicate headers', async () => {
    const d = data(); d.sheets[0]!.data[0]!.rowData[0]!.values![2] = literal('Name')
    await expect(setup(meta(), d).read()).rejects.toMatchObject({ code: 'unsupported_sheet' })
  })
  it('redacts provider and network errors and does not retry', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret body', { status: 403 }))
    const reader = createGoogleSheetsSyncReader({ spreadsheetId: ID, getAccessToken: async () => 'token', fetch: fetcher })
    await expect(reader.read()).rejects.toMatchObject({ code: 'unauthorized', message: 'Google Sheets preview unavailable (unauthorized).' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockRejectedValue(new Error('sensitive detail'))
    await expect(reader.read()).rejects.toMatchObject({ code: 'unavailable', message: 'Google Sheets preview unavailable (unavailable).' })
  })
  it('rejects URLs and unsafe target IDs before network access', () => {
    expect(() => createGoogleSheetsSyncReader({ spreadsheetId: 'https://example.com/sheet', getAccessToken: async () => 'token' })).toThrow('configuration')
  })
  it('rejects token errors without exposing them', async () => {
    const fetcher = vi.fn()
    await expect(createGoogleSheetsSyncReader({ spreadsheetId: ID, getAccessToken: async () => { throw new Error('secret') }, fetch: fetcher }).read()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('Google Sheets reader rich-cell safety metadata', () => {
  it('preserves chip/rich-text/link and derived-cell flags plus number format', async () => {
    const d = data()
    const cells = d.sheets[0]!.data[0]!.rowData[2]!.values!
    Object.assign(cells[0]!, { chipRuns: [{ startIndex: 0, chip: {} }], effectiveFormat: { numberFormat: { type: 'TEXT' } } })
    Object.assign(cells[1]!, { textFormatRuns: [{ startIndex: 0 }], hyperlink: 'https://example.com/' })
    delete (cells[2]! as { userEnteredValue?: unknown }).userEnteredValue
    const snap = await setup(meta(), d).read()
    expect(snap.tabs[0]!.rows[2]!.cells[0]).toMatchObject({ hasRichContent: true, numberFormatType: 'TEXT' })
    expect(snap.tabs[0]!.rows[2]!.cells[1]).toMatchObject({ hasRichContent: true })
    expect(snap.tabs[0]!.rows[2]!.cells[2]).toMatchObject({ derived: true })
  })
})

describe('minimal import column reads', () => {
  const columns = { Contacts: ['Contact ID', 'Name'], 'Follow-ups': ['Task ID', 'Action'] } as const
  const headers = () => {
    const d = data()
    for (const sheet of d.sheets) sheet.data[0]!.rowData = [sheet.data[0]!.rowData[0]!]
    return d
  }
  const projected = () => {
    const d = data()
    return { spreadsheetId: ID, sheets: d.sheets.map(s => ({ properties: s.properties,
      data: columns[s.properties.title as keyof typeof columns].map(name => {
        const col = s.data[0]!.rowData[0]!.values!.findIndex(c => c.userEnteredValue && 'stringValue' in c.userEnteredValue && c.userEnteredValue.stringValue === name)
        return { startColumn: col, rowData: s.data[0]!.rowData.map(r => ({ values: r.values?.[col] ? [r.values[col]] : [] })) }
      }) })) }
  }
  const reader = (d: unknown = projected()) => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(meta())))
      .mockResolvedValueOnce(new Response(JSON.stringify(headers()))).mockResolvedValueOnce(new Response(JSON.stringify(d)))
    return { fetcher, read: createGoogleSheetsSyncReader({ spreadsheetId: ID, getAccessToken: async () => 'fictional', columns, fetch: fetcher }).read }
  }
  it('fetches headers, then only requested columns, retaining physical row positions', async () => {
    const s = reader(); const snap = await s.read()
    expect(snap.tabs[0]!.headers).toEqual(['Contact ID', 'Name', 'Status'])
    expect(snap.tabs[0]!.rows[2]!.cells.map(c => c.value)).toEqual(['C001', 'Test Person', null])
    expect(new URL(s.fetcher.mock.calls[1]![0]).searchParams.getAll('ranges')).toEqual(["'Contacts'!A1:C1", "'Follow-ups'!A1:C1"])
    expect(new URL(s.fetcher.mock.calls[2]![0]).searchParams.getAll('ranges')).toEqual(["'Contacts'!A1:A10", "'Contacts'!B1:B10", "'Follow-ups'!A1:A10", "'Follow-ups'!C1:C10"])
    for (const [, options] of s.fetcher.mock.calls) expect(options.method).toBe('GET')
  })
  it('rejects changed headers, missing columns and unexpected range positions', async () => {
    const changed = projected(); changed.sheets[0]!.data[0]!.rowData[0]!.values = [literal('Changed ID')]
    await expect(reader(changed).read()).rejects.toThrow()
    const missing = projected(); missing.sheets[0]!.data.pop()
    await expect(reader(missing).read()).rejects.toThrow()
    const moved = projected(); moved.sheets[0]!.data[0]!.startColumn = 2
    await expect(reader(moved).read()).rejects.toThrow()
  })
  it('bounds an undeclared streaming response before parsing it', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8_000_001)) }, cancel })
    const fetcher = vi.fn().mockResolvedValue(new Response(body))
    await expect(createGoogleSheetsSyncReader({ spreadsheetId: ID, getAccessToken: async () => 'fictional', fetch: fetcher }).read()).rejects.toMatchObject({ code: 'invalid_response' })
    expect(cancel).toHaveBeenCalled()
  })
})
