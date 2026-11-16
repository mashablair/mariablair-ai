import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDb, errorOf } from './harness'

let db: PGlite
const id: Record<string, string> = {}

const one = async (sql: string, params: unknown[] = []) => {
  const r = await db.query<{ id: string }>(sql, params)
  return r.rows[0]!.id
}

beforeAll(async () => {
  db = await createDb()
  // Users: Maria (admin), Ana and Ben (clients), Eve (signed up, unverified email matching Ben... see below)
  id.maria = await one(`insert into auth.users (email, email_confirmed_at) values ('mashablair@gmail.com', now()) returning id`)
  id.ana = await one(`insert into auth.users (email, email_confirmed_at) values ('ana@example.com', now()) returning id`)
  id.ben = await one(`insert into auth.users (email, email_confirmed_at) values ('Ben@Example.com', now()) returning id`)
  id.stranger = await one(`insert into auth.users (email, email_confirmed_at) values ('stranger@example.com', now()) returning id`)
  id.unverified = await one(`insert into auth.users (email, email_confirmed_at) values ('carl@example.com', null) returning id`)

  // CRM data (inserted as the table owner, like the API's service role would)
  id.anaC = await one(`insert into contacts (first_name, email, stage, next_action) values ('Ana', 'ana@example.com', 'active_client', 'secret plan') returning id`)
  id.benC = await one(`insert into contacts (first_name, email) values ('Ben', 'ben@example.com') returning id`)
  id.carlC = await one(`insert into contacts (first_name, email) values ('Carl', 'carl@example.com') returning id`)
  for (const who of ['ana', 'ben'] as const) {
    const c = id[`${who}C`]
    await db.query(`insert into internal_notes (contact_id, body) values ($1, 'private note')`, [c])
    await db.query(`insert into tasks (contact_id, title) values ($1, 'follow up')`, [c])
    id[`${who}Sub`] = await one(
      `insert into assessment_submissions (contact_id, track, answers, score, level) values ($1, 'business', '{}', 5, 'Curious') returning id`, [c])
    await db.query(`insert into recommendations (contact_id, title, shared) values ($1, 'shared rec', true), ($1, 'draft rec', false)`, [c])
    await db.query(
      `insert into sessions (contact_id, plan, outcomes, agreed_rate_cents, client_visible_summary) values ($1, 'internal plan', 'internal outcomes', 9900, 'summary for ' || $2)`, [c, who])
    id[`${who}Mat`] = await one(
      `insert into materials (title, storage_path, file_name) values ($1, $2, 'deck.pptx') returning id`, [`${who} deck`, `${who}/deck.pptx`])
    await db.query(`insert into material_grants (material_id, contact_id) values ($1, $2)`, [id[`${who}Mat`], c])
    await db.query(`insert into storage.objects (bucket_id, name) values ('materials', $1)`, [`${who}/deck.pptx`])
    await db.query(`insert into charges (contact_id, description, amount_cents) values ($1, 'Session', 19800)`, [c])
    await db.query(`insert into payments (contact_id, amount_cents, method) values ($1, 9900, 'cash')`, [c])
    await db.query(
      `insert into entitlements (contact_id, offer_id, source) select $1, id, 'grant' from offers where key = 'ai_training_session'`, [c])
  }
  await db.query(`insert into materials (title, storage_path, file_name) values ('ungranted', 'library/ungranted.pdf', 'ungranted.pdf')`)
  await db.query(`insert into storage.objects (bucket_id, name) values ('materials', 'library/ungranted.pdf')`)
  await db.query(`insert into stripe_events (id, type, payload) values ('evt_1', 'checkout.session.completed', '{}')`)

  for (const who of ['maria', 'ana', 'ben', 'stranger'] as const) await as(db, id[who]!, `select link_my_account()`)
})

describe('schema hygiene', () => {
  it('has RLS enabled on every public table', async () => {
    const r = await db.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`)
    expect(r.rows).toEqual([])
  })

  it('gives anonymous visitors no access to any table or function', async () => {
    const tables = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)
    expect(tables.rows.length).toBeGreaterThan(20)
    for (const { tablename } of tables.rows) {
      expect(await errorOf(db, null, `select * from public."${tablename}" limit 1`), tablename).toMatch(/permission denied/)
    }
    expect(await errorOf(db, null, `select * from contact_balances`)).toMatch(/permission denied/)
    expect(await errorOf(db, null, `select link_my_account()`)).toMatch(/permission denied/)
  })
})

describe('account linking', () => {
  it('links by verified email, case-insensitively', async () => {
    const [ana] = await as(db, id.ana!, `select link_my_account() as r`)
    expect(ana!.r).toMatchObject({ contact_id: id.anaC, is_admin: false })
    const [ben] = await as(db, id.ben!, `select my_contact_id() as c`)
    expect(ben!.c).toBe(id.benC)
  })

  it('refuses an unverified email, so nobody can claim a contact by typing its address', async () => {
    expect(await errorOf(db, id.unverified!, `select link_my_account()`)).toMatch(/not verified/)
    const [r] = await as(db, id.unverified!, `select my_contact_id() as c`)
    expect(r!.c).toBeNull()
  })

  it('does not let a client point their profile at another contact', async () => {
    await as(db, id.ana!, `update profiles set contact_id = $1 where user_id = $2`, [id.benC, id.ana])
    const [r] = await as(db, id.ana!, `select my_contact_id() as c`)
    expect(r!.c).toBe(id.anaC)
    expect(await errorOf(db, id.stranger!, `insert into profiles (user_id, contact_id, email) values ($1, $2, 'x')`, [id.stranger, id.benC]))
      .toMatch(/row-level security|duplicate key/)
  })

  it('makes only the allow-listed address an admin', async () => {
    expect((await as(db, id.maria!, `select is_admin() as a`))[0]!.a).toBe(true)
    expect((await as(db, id.ana!, `select is_admin() as a`))[0]!.a).toBe(false)
    expect(await errorOf(db, id.ana!, `insert into admins (email, user_id) values ('ana@example.com', $1)`, [id.ana])).toMatch(/row-level security/)
  })
})

describe('a client', () => {
  const adminOnly = ['contacts', 'companies', 'events', 'contact_events', 'internal_notes', 'tasks', 'sessions',
    'intake_templates', 'intake_responses', 'session_materials', 'charges', 'payments', 'stripe_events', 'admins',
    'assessment_versions', 'contact_balances']

  it.each(adminOnly)('reads nothing from %s', async (table) => {
    expect(await as(db, id.ana!, `select * from ${table}`)).toEqual([])
  })

  it('sees only their own rows in the shared tables', async () => {
    const subs = await as(db, id.ana!, `select id, contact_id from assessment_submissions`)
    expect(subs).toEqual([{ id: id.anaSub, contact_id: id.anaC }])
    const recs = await as(db, id.ana!, `select title, contact_id from recommendations`)
    expect(recs).toEqual([{ title: 'shared rec', contact_id: id.anaC }])
    const mats = await as(db, id.ana!, `select id from materials`)
    expect(mats).toEqual([{ id: id.anaMat }])
    const grants = await as(db, id.ana!, `select contact_id from material_grants`)
    expect(grants).toEqual([{ contact_id: id.anaC }])
    const ents = await as(db, id.ana!, `select contact_id from entitlements`)
    expect(ents).toEqual([{ contact_id: id.anaC }])
    const profiles = await as(db, id.ana!, `select user_id from profiles`)
    expect(profiles).toEqual([{ user_id: id.ana }])
    const files = await as(db, id.ana!, `select name from storage.objects`)
    expect(files).toEqual([{ name: 'ana/deck.pptx' }])
  })

  it('gets only the client-safe columns about themselves', async () => {
    const [me] = await as(db, id.ana!, `select * from my_contact()`)
    expect(me).toEqual({ id: id.anaC, first_name: 'Ana', last_name: '', email: 'ana@example.com' })
    const sessions = await as(db, id.ana!, `select * from my_sessions()`)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.client_visible_summary).toBe('summary for ana')
    expect(Object.keys(sessions[0]!)).not.toContain('plan')
    expect(Object.keys(sessions[0]!)).not.toContain('agreed_rate_cents')
  })

  it('cannot write anywhere', async () => {
    expect(await errorOf(db, id.ana!, `insert into internal_notes (contact_id, body) values ($1, 'x')`, [id.anaC])).toMatch(/row-level security/)
    expect(await errorOf(db, id.ana!, `insert into material_grants (material_id, contact_id) values ($1, $2)`, [id.benMat, id.anaC])).toMatch(/row-level security/)
    expect(await errorOf(db, id.ana!, `insert into entitlements (contact_id, offer_id, source) select $1, id, 'grant' from offers limit 1`, [id.anaC])).toMatch(/row-level security/)
    expect(await as(db, id.ana!, `update recommendations set title = 'hacked' returning id`)).toEqual([])
    expect(await as(db, id.ana!, `delete from assessment_submissions returning id`)).toEqual([])
    expect(await errorOf(db, id.ana!, `insert into storage.objects (bucket_id, name) values ('materials', 'ana/evil.pdf')`)).toMatch(/row-level security/)
  })

  it('with no matching contact sees nothing at all', async () => {
    for (const t of ['assessment_submissions', 'recommendations', 'materials', 'material_grants', 'entitlements', 'internal_notes', 'contacts']) {
      expect(await as(db, id.stranger!, `select * from ${t}`), t).toEqual([])
    }
    expect(await as(db, id.stranger!, `select * from storage.objects`)).toEqual([])
  })
})

describe('the admin', () => {
  it('reads and writes everything', async () => {
    expect(await as(db, id.maria!, `select id from contacts`)).toHaveLength(3)
    expect(await as(db, id.maria!, `select id from internal_notes`)).toHaveLength(2)
    expect(await as(db, id.maria!, `select name from storage.objects`)).toHaveLength(3)
    const [c] = await as(db, id.maria!, `insert into contacts (first_name) values ('Dana') returning id`)
    await as(db, id.maria!, `insert into internal_notes (contact_id, body) values ($1, 'met at chamber mixer')`, [c!.id])
    await as(db, id.maria!, `delete from contacts where id = $1`, [c!.id])
  })

  it('sees balances as charges minus matched payments', async () => {
    const rows = await as(db, id.maria!, `select * from contact_balances where contact_id = $1`, [id.anaC])
    expect(rows).toEqual([{ contact_id: id.anaC, charged_cents: 19800, paid_cents: 9900, balance_cents: 9900 }])
  })
})
