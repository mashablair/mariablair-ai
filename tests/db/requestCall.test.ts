import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, errorOf } from './harness'

let db: PGlite
const CALL = `select request_call($1::jsonb, $2, $3) as r`
const request = async (contact: object, message = 'Our front desk drowns in email.', task = 'Reply to free call request') =>
  db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`)
    return (await tx.query<{ r: { contact_id: string; is_new_contact: boolean } }>(CALL, [JSON.stringify(contact), message, task])).rows[0]!.r
  })

beforeAll(async () => { db = await createDb() })

describe('request_call', () => {
  it('creates a new lead with company, private note and a task due today', async () => {
    const r = await request({ first_name: 'Dana', last_name: 'Cole', email: ' Dana@Shop.example ', phone: '561-555-0100', company: 'Cole Boutique' })
    expect(r.is_new_contact).toBe(true)
    const c = (await db.query<any>(`select c.first_name, c.email, c.phone, c.stage, c.source, c.next_action, c.follow_up_date = current_date as due_today, co.name as company
      from contacts c left join companies co on co.id = c.company_id where c.id = $1`, [r.contact_id])).rows[0]
    expect(c).toEqual({ first_name: 'Dana', email: 'dana@shop.example', phone: '561-555-0100', stage: 'new', source: 'Free call request',
      next_action: 'Reply to free call request', due_today: true, company: 'Cole Boutique' })
    const note = (await db.query<any>(`select body from internal_notes where contact_id = $1`, [r.contact_id])).rows[0].body
    expect(note).toBe('Free call request from Cole Boutique:\nOur front desk drowns in email.')
    const task = (await db.query<any>(`select title, due_date = current_date as today from tasks where contact_id = $1`, [r.contact_id])).rows[0]
    expect(task).toEqual({ title: 'Reply to free call request', today: true })
  })

  it('reuses an existing contact and never overwrites what Maria entered', async () => {
    const id = (await db.query<{ id: string }>(`insert into contacts (first_name, email, phone, stage, next_action, follow_up_date)
      values ('Elena', 'elena@example.com', '111', 'active_client', 'Send recap', current_date + 10) returning id`)).rows[0]!.id
    const r = await request({ first_name: 'Someone Else', email: 'ELENA@example.com', phone: '999', company: 'Other Co' })
    expect(r).toEqual({ contact_id: id, is_new_contact: false })
    const c = (await db.query<any>(`select first_name, phone, stage, next_action, follow_up_date = current_date as due_today, company_id from contacts where id = $1`, [id])).rows[0]
    expect(c).toEqual({ first_name: 'Elena', phone: '111', stage: 'active_client', next_action: 'Send recap', due_today: true, company_id: null })
    expect((await db.query(`select 1 from companies where name = 'Other Co'`)).rows).toHaveLength(0)
    expect((await db.query(`select 1 from tasks where contact_id = $1`, [id])).rows).toHaveLength(1)
  })

  it('keeps an empty message readable', async () => {
    const r = await request({ first_name: 'Sam', email: 'sam@example.com' }, '   ')
    expect((await db.query<any>(`select body from internal_notes where contact_id = $1`, [r.contact_id])).rows[0].body).toBe('Free call request:\n(no message)')
  })

  it('cannot be called by visitors or signed-in users', async () => {
    const user = (await db.query<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ('x@example.com', now()) returning id`)).rows[0]!.id
    const args = [JSON.stringify({ first_name: 'X', email: 'x@example.com' }), 'hi', 't']
    expect(await errorOf(db, null, CALL, args)).toMatch(/permission denied/)
    expect(await errorOf(db, user, CALL, args)).toMatch(/permission denied/)
  })
})
