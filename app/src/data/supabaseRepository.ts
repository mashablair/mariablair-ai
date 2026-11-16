import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssessmentSubmission, ContactBalance, Insert, LinkKey, LinkName, LinkTables, Patch, Row, TableName } from '@shared/types'
import type { Query, Repository } from './repository'

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export class SupabaseRepository implements Repository {
  readonly isDemo = false
  constructor(private db: SupabaseClient) {}

  async list<T extends TableName>(table: T, query: Query<T> = {}): Promise<Row<T>[]> {
    let q = this.db.from(table).select('*')
    for (const [k, v] of Object.entries(query.where ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v as string)
    if (query.order) q = q.order(query.order.column, { ascending: query.order.ascending ?? true })
    else q = q.order('created_at', { ascending: false })
    if (query.limit) q = q.limit(query.limit)
    return unwrap(await q) as Row<T>[]
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    return unwrap(await this.db.from(table).select('*').eq('id', id).maybeSingle()) as Row<T> | null
  }

  async insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>> {
    return unwrap(await this.db.from(table).insert(values as object).select().single()) as Row<T>
  }

  async update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>> {
    return unwrap(await this.db.from(table).update(patch as object).eq('id', id).select().single()) as Row<T>
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    unwrap(await this.db.from(table).delete().eq('id', id))
  }

  async links<T extends LinkName>(table: T, where: Partial<LinkKey<T>> = {}): Promise<LinkTables[T][]> {
    return unwrap(await this.db.from(table).select('*').match(where as Record<string, unknown>)) as LinkTables[T][]
  }

  async link<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void> {
    unwrap(await this.db.from(table).upsert(key as object, { ignoreDuplicates: true }))
  }

  async unlink<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void> {
    unwrap(await this.db.from(table).delete().match(key as Record<string, unknown>))
  }

  async balances(): Promise<ContactBalance[]> {
    return unwrap(await this.db.from('contact_balances').select('*')) as ContactBalance[]
  }

  // Row Level Security returns only the signed-in client's own rows.
  async mySubmissions(): Promise<AssessmentSubmission[]> {
    return unwrap(await this.db.from('assessment_submissions').select('*').order('created_at', { ascending: false })) as AssessmentSubmission[]
  }
}
