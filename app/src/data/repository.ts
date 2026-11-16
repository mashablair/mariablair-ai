import type { AssessmentSubmission, ClientProduct, ClientSession, ContactBalance, Material, Payment, Recommendation, Insert, LinkKey, LinkName, LinkTables, Patch, Row, TableName } from '@shared/types'

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
  myRecommendations(): Promise<Recommendation[]>
  myProducts(): Promise<ClientProduct[]>
  mySessions(): Promise<ClientSession[]>
}

/**
 * Resolve a payment from the review queue: tie it to a contact (and optionally an offer).
 * From then on it counts toward the balance, and the client owns the offer.
 */
export async function matchPayment(repo: Repository, payment: Payment, contactId: string, offerId: string | null): Promise<void> {
  await repo.update('payments', payment.id, { contact_id: contactId, offer_id: offerId, match_status: 'matched' })
  if (offerId) {
    const existing = await repo.list('entitlements', { where: { payment_id: payment.id } })
    if (existing.length === 0) await repo.insert('entitlements', { contact_id: contactId, offer_id: offerId, source: 'purchase', payment_id: payment.id })
  }
}
