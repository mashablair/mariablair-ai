import type { AssessmentSubmission, ContactBalance, Material, Insert, LinkKey, LinkName, LinkTables, Patch, Row, TableName } from '@shared/types'

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

  // Files. Stored in a private bucket; downloads go through short-lived signed links.
  uploadMaterial(file: File, meta: { title: string; tags: string[] }): Promise<Material>
  removeMaterial(material: Material): Promise<void>
  materialUrl(material: Material): Promise<string>

  // Client portal: what the signed-in client may see about themselves.
  mySubmissions(): Promise<AssessmentSubmission[]>
  myMaterials(): Promise<Material[]>
}
