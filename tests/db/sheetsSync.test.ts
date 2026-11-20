import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { as, createDb } from './harness'
import type { PGlite } from '@electric-sql/pglite'
import type { SyncRecord } from '../../shared/sheetsSync'

const key = 'a'.repeat(64)
const missingKey = 'b'.repeat(64)
const token = '00000000-0000-4000-8000-000000000001'
const rival = '00000000-0000-4000-8000-000000000002'
const operation = '00000000-0000-4000-8000-000000000003'
const owner = '00000000-0000-4000-8000-000000000004'
const contact = '00000000-0000-4000-8000-000000000005'
const followUp = '00000000-0000-4000-8000-000000000006'
const rpcSql = 'select public.crm_sheets_sync($1,$2,$3::jsonb) as result'

describe('Sheets sync RPC and storage', () => {
  let db: PGlite
  async function rpc<T = unknown>(action: string, args: unknown = {}, connection = key) {
    return db.transaction(async tx => {
      await tx.exec('set local role service_role')
      const { rows } = await tx.query<{ result: T }>(rpcSql, [connection, action, JSON.stringify(args)])
      return rows[0]!.result
    })
  }
  const read = () => rpc<{app: SyncRecord[],baseline:SyncRecord[],binding:string,links:unknown[],unlinkedApp:number}>('read')
  async function prepare(update?: (rows: SyncRecord[]) => void) {
    const current = await read()
    const before = { ...current, sheet: current.app }
    const app = structuredClone(current.app)
    update?.(app)
    const receipt = { id: operation, owner, previewId: operation, before, target: { app, sheet: app, baseline: app }, phase:'prepared' }
    await rpc('preview_put',{preview:{id:operation,owner,expiresAt:Date.now()+600_000,input:before}})
    await rpc('acquire',{token})
    await rpc('receipt_put',{token,receipt})
    return receipt
  }
  beforeEach(async () => {
    db = await createDb()
    await db.query('insert into public.crm_sheets_sync_connection(connection_key) values ($1)',[key])
    await db.query("insert into public.contacts(id,first_name,email,source,next_action,ai_needs) values ($1,'Example','private@example.invalid','Workshop','Send summary','private answer')",[contact])
    await db.query("insert into public.tasks(id,contact_id,title,due_date,done_at) values ($1,$2,'Send summary','2026-12-21',now())",[followUp,contact])
    await db.query("insert into public.crm_sheets_sync_links values ($1,'contacts','C-001',$2),($1,'tasks','T-001',$3)",[key,contact,followUp])
  })
  afterEach(async () => { await db?.close() })
  it('denies RPC and direct storage to anon and authenticated, including known IDs', async () => {
    for (const caller of [null, owner]) {
      await expect(as(db,caller,rpcSql,[key,'read','{}'])).rejects.toThrow(/permission denied/)
      await expect(as(db,caller,'select * from public.crm_sheets_sync_links')).rejects.toThrow(/permission denied/)
      await expect(as(db,caller,'select * from public.crm_sheets_sync_receipts')).rejects.toThrow(/permission denied/)
    }
  })
  it('pins the connection key and emits only the allowed projection, real linked contact ID, digest and unlinked count', async () => {
    await expect(rpc('read',{},missingKey)).rejects.toThrow(/not provisioned/)
    await db.exec("insert into public.contacts(first_name) values ('Unlinked')")
    const before = await read()
    expect(before.unlinkedApp).toBe(1)
    expect(before.binding).toMatch(/^[a-f0-9]{64}$/)
    expect(before.app).toEqual([
      {kind:'contacts',id:'C-001',fields:{name:'',source:'Workshop',next_action:'Send summary',follow_up_date:''}},
      {kind:'tasks',id:'T-001',fields:{contact_id:'C-001',title:'Send summary',due_date:'2026-12-21',status:'open'}},
    ])
    expect(JSON.stringify(before)).not.toMatch(/private|Unlinked|done_at/)
    expect((await read()).binding).toBe(before.binding)
  })
  it('fences stale leases and blocks manual mapping changes while active', async () => {
    expect(await rpc('acquire',{token})).toBe(true)
    expect(await rpc('acquire',{token:rival})).toBe(false)
    await expect(db.query("insert into public.crm_sheets_sync_links values ($1,'contacts','C-new',$2)",[key,owner])).rejects.toThrow(/blocked/)
    await db.exec("update public.crm_sheets_sync_connection set lease_until=clock_timestamp()-interval '1 second'")
    expect(await rpc('acquire',{token:rival})).toBe(true)
    await rpc('release',{token})
    expect(await rpc('lease_check',{token:rival})).toBe(true)
    await expect(rpc('lease_check',{token})).rejects.toThrow(/lease expired/)
  })
  it('atomically writes allowed app columns and completes baseline plus journal only after expected app state', async () => {
    const receipt = await prepare(app => { app[0]!.fields.next_action = 'Review draft'; app[1]!.fields.due_date = '' })
    await expect(rpc('complete',{token,id:operation})).rejects.toThrow(/completion mismatch/)
    expect(await rpc('pending')).toMatchObject({id:operation,phase:'prepared'})
    await rpc('app_write',{token,id:operation})
    await expect(rpc('app_write',{token,id:operation})).rejects.toThrow(/expectations changed/)
    expect(await read()).toMatchObject({app:receipt.target.app,baseline:[]})
    await rpc('complete',{token,id:operation})
    expect(await read()).toMatchObject({app:receipt.target.app,baseline:receipt.target.app})
    expect(await rpc('pending')).toBeNull()
    expect(await rpc('receipt_get',{id:operation})).toMatchObject({phase:'complete'})
    const {rows} = await db.query('select email, ai_needs from public.contacts where id=$1',[contact])
    expect(rows).toEqual([{email:'private@example.invalid',ai_needs:'private answer'}])
    expect((await db.query('select done_at is not null as is_done from public.tasks where id=$1',[followUp])).rows).toEqual([{is_done:true}])
  })
  it('does not clobber an intervening CRM edit or advance baseline after a failed CAS', async () => {
    const receipt = await prepare(app => { app[0]!.fields.next_action = 'Sheet edit'; app[1]!.fields.title = 'Another Sheet edit' })
    await db.query("update public.tasks set title='Edited in CRM' where id=$1",[followUp])
    await expect(rpc('app_write',{token,id:operation})).rejects.toThrow(/expectations changed/)
    await rpc('receipt_put',{token,receipt:{...receipt,phase:'needs_review',target:{}}})
    expect(await rpc('pending')).toMatchObject({phase:'needs_review',target:receipt.target})
    expect((await read()).app[0]!.fields.next_action).toBe('Send summary')
    expect((await read()).baseline).toEqual([])
    await rpc('release',{token})
    await expect(db.query("insert into public.crm_sheets_sync_links values ($1,'contacts','C-new',$2)",[key,owner])).rejects.toThrow(/blocked/)
  })
  it('rejects writes to immutable fields and rolls back previously updated rows', async () => {
    await prepare(app => { app[0]!.fields.source='Updated'; app[1]!.fields.status='done' })
    await expect(rpc('app_write',{token,id:operation})).rejects.toThrow(/Unwritable follow-up field/)
    expect((await read()).app[0]!.fields.source).toBe('Workshop')
  })
  it('link digest invalidates earlier preview; link mutations and duplicates are not permitted', async () => {
    const before = await read()
    await expect(db.query("update public.crm_sheets_sync_links set external_id='C-002' where kind='contacts'")).rejects.toThrow(/append only/)
    await expect(db.query("insert into public.crm_sheets_sync_links values ($1,'contacts','C-002',$2)",[key,contact])).rejects.toThrow(/unique constraint/)
    await db.query("insert into public.crm_sheets_sync_links values ($1,'contacts','C-002',$2)",[key,owner])
    expect((await read()).binding).not.toBe(before.binding)
    await rpc('preview_put',{preview:{id:operation,owner,expiresAt:Date.now()+600_000,input:before}})
    await rpc('acquire',{token})
    await expect(rpc('receipt_put',{token,receipt:{id:operation,previewId:operation,owner,before,target:before,phase:'prepared'}})).rejects.toThrow(/snapshot changed/)
  })
})
