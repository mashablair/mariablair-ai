import type { ContactBalance, Insert, LinkKey, LinkName, LinkTables, Patch, Row, TableName } from '@shared/types'

export type Query<T extends TableName> = {
  /** Exact-match filters. */
  where?: Partial<Row<T>>
  order?: { column: keyof Row<T> & string; ascending?: boolean }
  limit?: number
}

/**
 * The one door to data for the whole app. Two implementations:
 *  - SupabaseRepository: real data, protected by Row Level Security.
 *  - DemoRepository: fictional in-memory data for /demo (the portfolio version).
 * Screens never import Supabase directly.
 */
export interface Repository {
  readonly isDemo: boolean
  list<T extends TableName>(table: T, query?: Query<T>): Promise<Row<T>[]>
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>
  insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>>
  update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>>
  remove<T extends TableName>(table: T, id: string): Promise<void>

  links<T extends LinkName>(table: T, where?: Partial<LinkKey<T>>): Promise<LinkTables[T][]>
  link<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void>
  unlink<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void>

  balances(): Promise<ContactBalance[]>
}
