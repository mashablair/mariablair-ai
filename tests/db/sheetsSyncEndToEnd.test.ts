import { expect, it, vi } from 'vitest'
import { createApp } from '../../server/app'
import { SyncCoordinator } from '../../server/sync/coordinator'
import { createDurableSyncStore } from '../../server/sync/production'
import type { GoogleSheetsSyncSnapshot, SyncSheetTab } from '../../server/googleSheetsSyncReader'
import { createDb } from './harness'

const config = { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }
const key = 'd'.repeat(64)
const contact = '00000000-0000-4000-8000-000000000105'
const task = '00000000-0000-4000-8000-000000000106'
const owner = '00000000-0000-4000-8000-000000000104'
function tab(title: SyncSheetTab['title'], headers: string[], rows: (string | null)[][]): SyncSheetTab {
  return { title, sheetId: title === 'Contacts' ? 5 : 6, rowCount: 20, columnCount: headers.length, headers,
    rows: [headers, ...rows].map((r, index) => ({ row: index + 1, cells: headers.map((_, c) => (
      { row: index + 1, column: c + 1, value: r[c] ?? null, formula: null, formatted: r[c] ?? null })) })) }
}

it('runs authenticated UI API, Sheets projection, durable preview/CAS, outbound deferral and replay end-to-end', async () => {
  const db = await createDb()
  try {
    await db.query('insert into public.crm_sheets_sync_connection(connection_key) values ($1)', [key])
    await db.query("insert into public.contacts(id,first_name,email,source,next_action) values ($1,'Fictional Identity','private@example.invalid','Workshop','Old action')", [contact])
    await db.query("insert into public.tasks(id,contact_id,title,done_at) values ($1,$2,'Old task',now())", [task, contact])
    await db.query("insert into public.crm_sheets_sync_links values ($1,'contacts','SYN-C',$2),($1,'tasks','SYN-T',$3)", [key, contact, task])
    const snapshot: GoogleSheetsSyncSnapshot = { spreadsheetId: 'synthetic_sheet_test', tabs: [
      tab('Contacts', ['Contact ID', 'Name', 'First Met / How', 'Next Action', 'Follow-up Due', 'Status'],
        [['SYN-C', 'Fictional Sheet Identity', 'Workshop', 'New action', null, 'Private status history'],
          ['UNLINKED', 'Never expose this name', null, 'Never import unlinked row', null]]),
      tab('Follow-ups', ['Task ID', 'Contact ID', 'Action', 'Due Date', 'Status', 'Priority', 'Last Update / Notes'],
        [['SYN-T', 'SYN-C', 'New task', null, 'To review', 'High', 'Private note']]),
    ] }
    const rpc = async (action: string, args: Record<string, unknown> = {}) => db.transaction(async tx => {
      await tx.exec('set local role service_role')
      const { rows } = await tx.query<{result: unknown}>('select public.crm_sheets_sync($1,$2,$3::jsonb) as result', [key, action, JSON.stringify(args)])
      return rows[0]!.result
    })
    const externalWrite = vi.fn(async () => { throw new Error('Outbound is not allowed') })
    const reader = { read: async () => structuredClone(snapshot) }
    const api = createApp(undefined, { adminUser: async (_env, token) => token === 'admin' ? owner : null,
      coordinator: () => new SyncCoordinator(createDurableSyncStore(rpc, reader, externalWrite), undefined, undefined,
        { allowSheetWrites: false, allowAdditions: false }) })
    const post = (route: string, data: object = {}) => api.request('/api/sync/' + route, { method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify(data) }, config)
    const res = await post('preview')
    expect(res.status).toBe(200)
    const preview = await res.json()
    expect(preview.coverage).toMatchObject({ linked: 2, unlinkedApp: 0, unlinkedSheet: 1 })
    expect(preview.plan.changes).toHaveLength(2)
    expect(JSON.stringify(preview)).not.toMatch(/private@example|Fictional|Never expose|Private status history|Private note/)
    expect(await (await post('apply', { previewId: preview.id, choices: { 'contacts:SYN-C:next_action': 'sheet', 'tasks:SYN-T:title': 'sheet' } })).json()).toEqual({status:'complete', replay:false})
    expect(await (await post('apply', { previewId: preview.id })).json()).toEqual({status:'complete', replay:true})
    const next = await (await post('preview')).json()
    expect(next.plan.changes).toHaveLength(0)
    await db.query("update public.contacts set source='App-only edit' where id=$1", [contact])
    snapshot.tabs[1]!.rows[1]!.cells[2]!.value = 'Newer task'
    const mixed = await (await post('preview')).json()
    expect(mixed.plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({field:'source', direction:'to_sheet'}), expect.objectContaining({field:'title', direction:'to_app'}),
    ]))
    expect((await post('apply', { previewId: mixed.id })).status).toBe(200)
    expect(externalWrite).not.toHaveBeenCalled()
    expect((await db.query('select source,next_action,email from public.contacts where id=$1', [contact])).rows).toEqual([
      {source:'App-only edit', next_action:'New action', email:'private@example.invalid'},
    ])
    expect((await db.query('select title,done_at is not null as done from public.tasks where id=$1', [task])).rows).toEqual([{title:'Newer task',done:true}])
    expect((await (await post('preview')).json()).plan.changes).toEqual([expect.objectContaining({field:'source', direction:'to_sheet',baseValue:'Workshop'})])
    expect(snapshot.tabs[1]!.rows[1]!.cells.slice(4).map(c => c.value)).toEqual(['To review', 'High', 'Private note'])
  } finally { await db.close() }
})
