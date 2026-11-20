import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDb } from './harness'

const key = 'a'.repeat(64)
const operation = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
const admin = '00000000-0000-4000-8000-000000000003'
const otherAdmin = '00000000-0000-4000-8000-000000000004'
const nonAdmin = '00000000-0000-4000-8000-000000000005'
const sql = 'select public.crm_sheets_bootstrap($1,$2,$3,$4::jsonb) as result'
const contact = { id:'C-1', name:'Example Middle Last', source:'Synthetic event', next_action:'Review', follow_up_date:'2028-02-29' }
const task = { id:'T-1', contact_id:'C-1', title:'Synthetic task', due_date:'' }
const input = { id:operation, contacts:[contact], tasks:[task] }
const result = { id:operation, contactsCreated:1, tasksCreated:1, contactsSkipped:0, tasksSkipped:0 }

describe('CSV bootstrap service RPC', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await createDb()
    await db.query('insert into public.crm_sheets_sync_connection(connection_key) values ($1)',[key])
    await db.query("insert into auth.users(id,email) values ($1,'one@example.invalid'),($2,'two@example.invalid'),($3,'three@example.invalid')",[admin,otherAdmin,nonAdmin])
    await db.query("insert into public.admins(user_id,email) values ($1,'one@example.invalid'),($2,'two@example.invalid')",[admin,otherAdmin])
  })
  beforeEach(async () => {
    await db.exec('truncate public.crm_sheets_bootstrap_previews, public.crm_sheets_sync_receipts, public.crm_sheets_sync_links; truncate public.contacts cascade; update public.crm_sheets_sync_connection set lease_token=null, lease_until=null')
  })
  afterAll(async () => { await db?.close() })
  async function rpc(action: string, args: unknown, owner = admin, target = key) {
    return db.transaction(async tx => {
      await tx.exec('set local role service_role')
      return (await tx.query<{result:unknown}>(sql,[target,action,owner,JSON.stringify(args)])).rows[0]!.result
    })
  }
  const preview = () => rpc('preview', input)
  const apply = (owner = admin) => rpc('apply',{id:operation},owner)
  async function counts() {
    return (await db.query('select (select count(*)::int from public.contacts) as contacts,(select count(*)::int from public.tasks) as tasks,(select count(*)::int from public.crm_sheets_sync_links) as links')).rows[0]
  }

  it('denies browser roles, direct storage, unauthorized owners, and unprovisioned targets', async () => {
    for (const owner of [null,admin]) {
      await expect(as(db,owner,sql,[key,'preview',admin,JSON.stringify(input)])).rejects.toThrow(/permission denied/)
      await expect(as(db,owner,'select * from public.crm_sheets_bootstrap_previews')).rejects.toThrow(/permission denied/)
    }
    await expect(rpc('preview',input,nonAdmin)).rejects.toThrow('Bootstrap administrator required')
    await expect(rpc('preview',input,admin,'b'.repeat(64))).rejects.toThrow('Sync connection not provisioned')
    await expect(db.transaction(async tx => {
      await tx.exec('set local role service_role')
      await tx.query('select * from public.crm_sheets_bootstrap_previews')
    })).rejects.toThrow(/permission denied/)
  })

  it('rejects extra columns, duplicates, malformed dates and unresolved task associations', async () => {
    for (const [value,error] of [
      [{...input,contacts:[{...contact,email:'private@example.invalid'}]},'Invalid bootstrap fields'],
      [{...input,contacts:[contact,contact]},'Duplicate bootstrap external ID'],
      [{...input,contacts:[{...contact,id:'C:1'}]},'Invalid bootstrap external ID'],
      [{...input,contacts:[{...contact,follow_up_date:'2027-02-29'}]},'Invalid bootstrap date'],
      [{...input,tasks:[{...task,contact_id:'C-missing'}]},'Unresolved bootstrap contact reference'],
      [{...input,contacts:Array.from({length:201},(_,i)=>({...contact,id:`C-${i}`}))},'Bootstrap row limit exceeded'],
    ] as const) await expect(rpc('preview',value)).rejects.toThrow(error)
    expect(await counts()).toEqual({contacts:0,tasks:0,links:0})
  })

  it('previews without CRM writes, applies linked rows atomically and replays counts only', async () => {
    expect(await preview()).toEqual({id:operation,canApply:true,contacts:[{id:'C-1',name:contact.name,disposition:'create'}],
      tasks:[{id:'T-1',title:task.title,contact_id:'C-1',disposition:'create'}]})
    expect(await counts()).toEqual({contacts:0,tasks:0,links:0})
    await expect(apply(otherAdmin)).rejects.toThrow('Bootstrap preview unavailable')
    expect(await apply()).toEqual(result)
    expect(await apply()).toEqual(result)
    expect(await counts()).toEqual({contacts:1,tasks:1,links:2})
    expect((await db.query(`
      select c.first_name,c.last_name,c.stage,c.email,to_char(c.follow_up_date,'YYYY-MM-DD') as follow_up_date,
        t.contact_id=c.id as same_contact,t.done_at is null as open
      from public.contacts c cross join public.tasks t
    `)).rows).toEqual([{first_name:contact.name,last_name:'',stage:'new',email:null,follow_up_date:'2028-02-29',same_contact:true,open:true}])
    expect((await db.query('select input,expected_plan,result from public.crm_sheets_bootstrap_previews')).rows)
      .toEqual([{input:null,expected_plan:null,result}])
  })

  it('retains CSV creation of distinct task IDs/dates with the same normalized Action', async () => {
    const recurring = { ...input, tasks: [{ ...task, due_date: '2026-12-01' },
      { ...task, id: 'T-2', title: '  SYNTHETIC   task ', due_date: '2026-12-08' }] }
    expect(await rpc('preview', recurring)).toMatchObject({ canApply: true })
    expect(await apply()).toMatchObject({ contactsCreated: 1, tasksCreated: 2 })
    expect((await db.query("select to_char(due_date,'YYYY-MM-DD') as due_date from public.tasks order by due_date")).rows)
      .toEqual([{ due_date: '2026-12-01' }, { due_date: '2026-12-08' }])
    expect(await counts()).toEqual({ contacts: 1, tasks: 2, links: 3 })
  })

  it('rolls back contact and links if follow-up insertion fails and can retry the untouched preview', async () => {
    await preview()
    await db.exec(`
      create function public.synthetic_reject_task() returns trigger language plpgsql as
        $$ begin raise exception 'Synthetic task failure'; end; $$;
      create trigger synthetic_reject_task before insert on public.tasks
        for each row execute function public.synthetic_reject_task();
    `)
    try {
      await expect(apply()).rejects.toThrow('Synthetic task failure')
      expect(await counts()).toEqual({contacts:0,tasks:0,links:0})
      expect((await db.query('select input is not null as pending, result from public.crm_sheets_bootstrap_previews')).rows)
        .toEqual([{pending:true,result:null}])
    } finally {
      await db.exec('drop trigger synthetic_reject_task on public.tasks; drop function public.synthetic_reject_task()')
    }
    expect(await apply()).toEqual(result)
  })

  it('skips previously linked records without overwriting intervening CRM edits', async () => {
    await preview()
    await apply()
    await db.exec("update public.contacts set source='Changed by CRM'; update public.tasks set title='Changed in CRM'")
    const revised = {...input,id:second,contacts:[{...contact,name:'CSV rename'}]}
    expect(await rpc('preview',revised)).toMatchObject({canApply:true,contacts:[{disposition:'linked'}],tasks:[{disposition:'linked'}]})
    expect(await rpc('apply',{id:second})).toEqual({id:second,contactsCreated:0,tasksCreated:0,contactsSkipped:1,tasksSkipped:1})
    expect((await db.query('select first_name,source from public.contacts')).rows).toEqual([{first_name:contact.name,source:'Changed by CRM'}])
    expect((await db.query('select title from public.tasks')).rows).toEqual([{title:'Changed in CRM'}])
  })

  it('blocks normalized exact-name matches and recomputes eligibility after preview', async () => {
    await preview()
    await db.exec("insert into public.contacts(first_name,last_name) values ('  EXAMPLE   middle ', '  last')")
    await expect(apply()).rejects.toThrow('Bootstrap preview stale')
    expect(await rpc('preview',{...input,id:second})).toMatchObject({canApply:false,contacts:[{disposition:'blocked'}],tasks:[{disposition:'blocked'}]})
    await expect(rpc('apply',{id:second})).rejects.toThrow('Bootstrap preview expired or blocked')
    expect(await counts()).toEqual({contacts:1,tasks:0,links:0})
  })

  it('blocks a new task with the same normalized action on its linked contact', async () => {
    await rpc('preview',{...input,tasks:[]})
    await apply()
    await db.exec("insert into public.tasks(contact_id,title) select id,'  SYNTHETIC   task ' from public.contacts")
    expect(await rpc('preview',{...input,id:second})).toMatchObject({canApply:false,contacts:[{disposition:'linked'}],tasks:[{disposition:'blocked'}]})
    expect(await counts()).toEqual({contacts:1,tasks:1,links:1})
  })

  it('rejects expired previews, locks out active sync, and refuses unresolved previous operations', async () => {
    await preview()
    await db.query("update public.crm_sheets_sync_connection set lease_token=$1,lease_until=now()+interval '1 minute'",[second])
    await expect(apply()).rejects.toThrow('Bootstrap blocked by active sync or recovery')
    await db.exec('update public.crm_sheets_sync_connection set lease_token=null,lease_until=null')
    await db.query("insert into public.crm_sheets_sync_receipts(connection_key,id,phase,body,links) values ($1,$2,'needs_review','{}','[]')",[key,second])
    await expect(apply()).rejects.toThrow('Bootstrap blocked by active sync or recovery')
    await db.exec("delete from public.crm_sheets_sync_receipts; update public.crm_sheets_bootstrap_previews set expires_at=now()-interval '1 second'")
    await expect(apply()).rejects.toThrow('Bootstrap preview expired or blocked')
    expect(await counts()).toEqual({contacts:0,tasks:0,links:0})
  })
})
