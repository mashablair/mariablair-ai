import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDb, errorOf } from './harness'

let db: PGlite
const CALL = `select submit_assessment($1::jsonb, 1, '{"q":[]}'::jsonb, 'business', '{"track":"business"}'::jsonb, 4, 'experimenting',
  '[{"title":"One","body":"First"},{"title":"Two","body":"Second"},{"title":"Three","body":"Third"}]'::jsonb, 'ai_training_session', $2) as r`

const submit = async (contact: object, task = 'Follow up on assessment') => {
  const r = await db.transaction(async (tx) => {
    await tx.exec(`set local role service_role`)
    return (await tx.query<{ r: { contact_id: string; submission_id: string; is_new_contact: boolean } }>(CALL, [JSON.stringify(contact), task])).rows[0]!.r
  })
  return r
}

beforeAll(async () => { db = await createDb() })

describe('submit_assessment', () => {
  it('creates the contact, company, submission, recommendations and a follow-up task', async () => {
    const r = await submit({ first_name: 'Priya', last_name: 'Nair', email: ' Priya@Books.example ', company: 'Palmetto Books', business_type: 'Bookkeeping', ai_needs: 'Wants: hours back' })
    expect(r.is_new_contact).toBe(true)
    const c = (await db.query<any>(`select c.*, co.name as company from contacts c left join companies co on co.id = c.company_id where c.id = $1`, [r.contact_id])).rows[0]
    expect(c).toMatchObject({ first_name: 'Priya', email: 'priya@books.example', stage: 'assessment_completed', source: 'Assessment', company: 'Palmetto Books', business_type: 'Bookkeeping' })
    expect((await db.query<any>(`select track, score, level, offer_key from assessment_submissions where id = $1`, [r.submission_id])).rows[0])
      .toEqual({ track: 'business', score: 4, level: 'experimenting', offer_key: 'ai_training_session' })
    expect((await db.query<any>(`select title, shared from recommendations where contact_id = $1 order by sort_order`, [r.contact_id])).rows)
      .toEqual([{ title: 'One', shared: false }, { title: 'Two', shared: false }, { title: 'Three', shared: false }])
    const task = (await db.query<any>(`select title, due_date > current_date as future, done_at from tasks where contact_id = $1`, [r.contact_id])).rows[0]
    expect(task).toEqual({ title: 'Follow up on assessment', future: true, done_at: null })
  })

  it('reuses the contact on a second submission and never overwrites what Maria entered', async () => {
    const id = (await db.query<{ id: string }>(
      `insert into contacts (first_name, email, stage, business_type) values ('Elena', 'elena@example.com', 'active_client', 'Dental practice') returning id`)).rows[0]!.id
    const r = await submit({ first_name: 'Not Elena', email: 'ELENA@example.com', company: 'Evil Corp', business_type: 'Other' })
    expect(r).toMatchObject({ contact_id: id, is_new_contact: false })
    const c = (await db.query<any>(`select first_name, stage, business_type, company_id from contacts where id = $1`, [id])).rows[0]
    expect(c).toEqual({ first_name: 'Elena', stage: 'active_client', business_type: 'Dental practice', company_id: null })
    expect((await db.query(`select 1 from companies where name = 'Evil Corp'`)).rows).toHaveLength(0)
    expect((await db.query(`select 1 from assessment_submissions where contact_id = $1`, [id])).rows).toHaveLength(1)
    expect((await db.query(`select 1 from assessment_versions`)).rows).toHaveLength(1)
  })

  it('moves an early-stage contact forward', async () => {
    const id = (await db.query<{ id: string }>(`insert into contacts (first_name, email, stage) values ('Tom', 'tom@example.com', 'contacted') returning id`)).rows[0]!.id
    await submit({ first_name: 'Tom', email: 'tom@example.com' })
    expect((await db.query<any>(`select stage from contacts where id = $1`, [id])).rows[0].stage).toBe('assessment_completed')
  })

  it('cannot be called by visitors or signed-in users', async () => {
    const user = (await db.query<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ('x@example.com', now()) returning id`)).rows[0]!.id
    const args = [JSON.stringify({ first_name: 'X', email: 'x@example.com' }), 't']
    expect(await errorOf(db, null, CALL, args)).toMatch(/permission denied/)
    expect(await errorOf(db, user, CALL, args)).toMatch(/permission denied/)
  })

  it('lets the new contact see only their own submission after signing in', async () => {
    const user = (await db.query<{ id: string }>(`insert into auth.users (email, email_confirmed_at) values ('priya@books.example', now()) returning id`)).rows[0]!.id
    await as(db, user, `select link_my_account()`)
    const subs = await as(db, user, `select level from assessment_submissions`)
    expect(subs).toEqual([{ level: 'experimenting' }])
    expect(await as(db, user, `select * from recommendations`)).toEqual([])
    expect(await as(db, user, `select * from tasks`)).toEqual([])
  })
})
