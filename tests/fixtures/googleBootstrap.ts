import type { GoogleSheetsSyncSnapshot, SyncSheetTitle } from '../../server/googleSheetsSyncReader'
import { BOOTSTRAP_COLUMNS } from '../../server/sync/googleBootstrap'

export const fictionalSource = () => ({
  contacts: [{ id: 'C-1', name: 'Fictional Person', source: 'Example event', next_action: 'Review outline', follow_up_date: '2028-02-29' }],
  tasks: [{ id: 'T-1', contact_id: 'C-1', title: 'Example follow-up', due_date: '' }],
  omitted: { contacts: ['Private Notes'], tasks: ['Status'] },
})
export function fictionalSnapshot(): GoogleSheetsSyncSnapshot {
  const source = fictionalSource()
  return { spreadsheetId: 'fictional_workbook', tabs: (['Contacts', 'Follow-ups'] as SyncSheetTitle[]).map((title, i) => {
    const headers = [...BOOTSTRAP_COLUMNS[title], i === 0 ? 'Private Notes' : 'Status']
    const values = i === 0 ? Object.values(source.contacts[0]!) : Object.values(source.tasks[0]!)
    return { title, sheetId: i + 1, rowCount: 10, columnCount: headers.length, headers,
      rows: [headers, [...values, 'OMITTED_PRIVATE_VALUE']].map((row, index) => ({ row: index + 1,
        cells: row.map((value, column) => ({ row: index + 1, column: column + 1, value, formula: null, formatted: null })) })) }
  }) }
}
