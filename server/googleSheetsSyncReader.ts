import { z } from 'zod'

// Server-only, read-only adapter. The configured spreadsheet is bound once, not
// selected by a browser request. Authorization/admin checks belong to the caller.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get
const TAB_NAMES = ['Contacts', 'Follow-ups'] as const
export type SyncSheetTitle = typeof TAB_NAMES[number]
export type SyncSheetCell = {
  row: number
  column: number
  value: string | number | boolean | null
  formula: string | null
  formatted: string | null
  /** Presence of chips or rich-text runs: replacing a value would destroy them. */
  hasRichContent?: boolean
  numberFormatType?: string
  derived?: boolean
}
export type SyncSheetTab = {
  title: SyncSheetTitle
  sheetId: number
  rowCount: number
  columnCount: number
  headers: string[]
  // Includes the header and explicit blank rows; positions are never compacted.
  rows: { row: number; cells: SyncSheetCell[] }[]
}
export type GoogleSheetsSyncSnapshot = {
  spreadsheetId: string
  tabs: SyncSheetTab[]
}
export class SheetsSyncReadError extends Error {
  constructor(readonly code: 'configuration' | 'unavailable' | 'unauthorized' | 'invalid_response' | 'unsupported_sheet') {
    super(`Google Sheets preview unavailable (${code}).`)
    this.name = 'SheetsSyncReadError'
  }
}
const fail = (code: ConstructorParameters<typeof SheetsSyncReadError>[0]): never => { throw new SheetsSyncReadError(code) }
const integer = z.number().int().nonnegative()
const props = z.object({ sheetId: integer, title: z.string(), sheetType: z.literal('GRID').optional(),
  gridProperties: z.object({ rowCount: z.number().int().positive(), columnCount: z.number().int().positive() }) })
const extended = z.object({ stringValue: z.string().optional(), numberValue: z.number().finite().optional(), boolValue: z.boolean().optional(),
  formulaValue: z.string().startsWith('=').optional(), errorValue: z.unknown().optional() }).strict().refine((v) => Object.keys(v).length <= 1)
const cell = z.object({ userEnteredValue: extended.optional(), effectiveValue: extended.optional(), formattedValue: z.string().optional(), hyperlink: z.string().optional(),
  chipRuns: z.array(z.unknown()).optional(), textFormatRuns: z.array(z.unknown()).optional(),
  effectiveFormat: z.object({ numberFormat: z.object({ type: z.string().optional() }).optional() }).optional() })
const grid = z.object({ startRow: integer.optional(), startColumn: integer.optional(), rowData: z.array(z.object({ values: z.array(cell).optional() })).optional() })
const response = z.object({ spreadsheetId: z.string(), sheets: z.array(z.object({ properties: props, data: z.array(grid).optional() })) })
const valueOf = (v: z.infer<typeof extended> | undefined): SyncSheetCell['value'] => {
  if (v?.errorValue !== undefined) return fail('unsupported_sheet')
  return v?.stringValue ?? v?.numberValue ?? v?.boolValue ?? null
}

export function createGoogleSheetsSyncReader(config: {
  spreadsheetId: string
  getAccessToken: () => Promise<string>
  fetch?: typeof fetch
}): { read: () => Promise<GoogleSheetsSyncSnapshot> } {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(config.spreadsheetId)) fail('configuration')
  const spreadsheetId = config.spreadsheetId
  const fetcher = config.fetch ?? fetch
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`
  async function request(params: URLSearchParams): Promise<z.infer<typeof response>> {
    let token: string
    try { token = await config.getAccessToken() } catch { return fail('unauthorized') }
    if (!token || /\s/.test(token)) return fail('unauthorized')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const result = await fetcher(`${base}?${params}`, { method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (result.status === 401 || result.status === 403) return fail('unauthorized')
      if (!result.ok) return fail('unavailable')
      // A bounded grid should not yield an unbounded body. Never include provider
      // response text (which may contain cells or credentials) in thrown errors.
      const declared = result.headers.get('content-length')
      if (declared && Number(declared) > 8_000_000) return fail('invalid_response')
      const body = await result.text()
      if (body.length > 8_000_000) return fail('invalid_response')
      let parsed: z.infer<typeof response>
      try { parsed = response.parse(JSON.parse(body)) } catch { return fail('invalid_response') }
      if (parsed.spreadsheetId !== spreadsheetId) return fail('invalid_response')
      return parsed
    } catch (error) {
      if (error instanceof SheetsSyncReadError) throw error
      return fail('unavailable')
    } finally { clearTimeout(timer) }
  }
  return { async read() {
    const metadata = await request(new URLSearchParams({ fields: 'spreadsheetId,sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)))' }))
    const tabs = TAB_NAMES.map((title) => {
      const matches = metadata.sheets.filter((s) => s.properties.title === title)
      if (matches.length !== 1) return fail('unsupported_sheet')
      const p = matches[0]!.properties
      const { rowCount, columnCount } = p.gridProperties
      if (rowCount > 1000 || columnCount > 26 || rowCount * columnCount > 30_000) return fail('unsupported_sheet')
      return p
    })
    if (tabs[0]!.sheetId === tabs[1]!.sheetId) return fail('invalid_response')
    const params = new URLSearchParams({ fields: 'spreadsheetId,sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,hyperlink,chipRuns,textFormatRuns,effectiveFormat(numberFormat(type))))))' })
    for (const p of tabs) params.append('ranges', `'${p.title}'!A1:${String.fromCharCode(64 + p.gridProperties.columnCount)}${p.gridProperties.rowCount}`)
    const data = await request(params)
    if (data.sheets.length !== 2) return fail('invalid_response')
    return { spreadsheetId, tabs: tabs.map((expected) => {
      const matches = data.sheets.filter((s) => s.properties.title === expected.title && s.properties.sheetId === expected.sheetId)
      if (matches.length !== 1) return fail('invalid_response')
      const got = matches[0]!
      if (got.properties.gridProperties.rowCount !== expected.gridProperties.rowCount || got.properties.gridProperties.columnCount !== expected.gridProperties.columnCount) return fail('invalid_response')
      if (got.data?.length !== 1) return fail('invalid_response')
      const g = got.data[0]!
      if ((g.startRow ?? 0) !== 0 || (g.startColumn ?? 0) !== 0) return fail('invalid_response')
      const { rowCount, columnCount } = expected.gridProperties
      if (!g.rowData?.length || g.rowData.length > rowCount) return fail('invalid_response')
      const rows = g.rowData.map((r, index) => {
        if ((r.values?.length ?? 0) > columnCount) return fail('invalid_response')
        const cells = Array.from({ length: columnCount }, (_, c) => {
          const v = r.values?.[c]
          if (v?.effectiveValue?.formulaValue) return fail('invalid_response')
          const formula = v?.userEnteredValue?.formulaValue ?? null
          const value = valueOf(v?.effectiveValue ?? (formula ? undefined : v?.userEnteredValue))
          return { row: index + 1, column: c + 1, value, formula, formatted: v?.formattedValue ?? null,
            ...((v?.chipRuns?.length || v?.textFormatRuns?.length || v?.hyperlink) ? { hasRichContent: true } : {}),
            ...((v?.userEnteredValue === undefined && v?.effectiveValue !== undefined) ? { derived: true } : {}),
            ...(v?.effectiveFormat?.numberFormat?.type ? { numberFormatType: v.effectiveFormat.numberFormat.type } : {}) }
        })
        return { row: index + 1, cells }
      })
      const headers = rows[0]!.cells.map((c) => {
        if (c.formula || (c.value !== null && typeof c.value !== 'string')) return fail('unsupported_sheet')
        return typeof c.value === 'string' ? c.value.trim() : ''
      })
      const nonempty = headers.filter(Boolean)
      if (new Set(nonempty).size !== nonempty.length || headers[0] !== (expected.title === 'Contacts' ? 'Contact ID' : 'Task ID')) return fail('unsupported_sheet')
      return { title: expected.title as SyncSheetTitle, sheetId: expected.sheetId, rowCount, columnCount, headers, rows }
    }) }
  } }
}
