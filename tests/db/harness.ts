// Runs the real migrations inside PGlite (Postgres compiled to WASM) behind a small shim of the
// parts of Supabase the migrations rely on: roles, auth.users, auth.uid(), storage tables.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
`

export async function createDb() {
  const db = new PGlite()
  await db.exec(SHIM)
  const dir = join(import.meta.dirname, '../../supabase/migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'))
  }
  return db
}

type Row = Record<string, any>

/** Run one statement the way Supabase would for a signed-in user (or an anonymous visitor). */
export async function as(db: PGlite, userId: string | null, sql: string, params: unknown[] = []): Promise<Row[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
    const res = await tx.query<Row>(sql, params)
    return res.rows
  })
}

/** Same, but returns the Postgres error message instead of throwing (null when it succeeded). */
export async function errorOf(db: PGlite, userId: string | null, sql: string, params: unknown[] = []) {
  try {
    await as(db, userId, sql, params)
    return null
  } catch (e) {
    return (e as Error).message
  }
}
