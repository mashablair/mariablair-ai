import type { ContactBalance, Insert, LinkKey, LinkName, LinkTables, Patch, Row, TableName, Tables } from '@shared/types'
import type { Query, Repository } from './repository'
import { demoSeed, type DemoData } from './demoSeed'

// What the database would fill in on insert.
const DEFAULTS: { [T in TableName]: Partial<Row<T>> } = {
  companies: { business_type: null, website: null, phone: null, city: null },
  contacts: {
    company_id: null, last_name: '', email: null, phone: null, job_title: null, business_type: null, ai_needs: null,
    stage: 'new', source: null, next_action: null, follow_up_date: null,
  },
  events: { event_date: null, location: null },
  sessions: {
    company_id: null, type: 'private', status: 'planned', title: null, scheduled_at: null, duration_minutes: null,
    agreed_rate_cents: null, location: null, plan: null, outcomes: null, client_visible_summary: null,
  },
  internal_notes: { contact_id: null, company_id: null, session_id: null },
  tasks: { contact_id: null, due_date: null, done_at: null },
  assessment_submissions: { version_id: null, recommendations: [], offer_key: null },
  intake_templates: { description: null, questions: [], active: true },
  intake_responses: { template_id: null, session_id: null, answers: {} },
  recommendations: { submission_id: null, body: '', shared: false, sort_order: 0 },
  materials: { kind: 'file', mime_type: null, size_bytes: null, tags: [] },
  offers: { description: null, price_cents: null, unit: 'flat', stripe_price_id: null, stripe_payment_link_id: null, stripe_payment_link_url: null, active: true },
  charges: { session_id: null, offer_id: null, invoice_ref: null },
  payments: {
    contact_id: null, offer_id: null, method: 'other', reference: null, payer_email: null, payer_name: null, stripe_event_id: null,
    stripe_checkout_session_id: null, stripe_payment_intent_id: null, match_status: 'matched',
  },
  entitlements: { payment_id: null },
}

// Rows removed together with their parent, mirroring "on delete cascade" in the schema.
const CASCADES: Partial<Record<TableName, [TableName | LinkName, string][]>> = {
  contacts: [['internal_notes', 'contact_id'], ['tasks', 'contact_id'], ['sessions', 'contact_id'], ['assessment_submissions', 'contact_id'],
    ['intake_responses', 'contact_id'], ['recommendations', 'contact_id'], ['charges', 'contact_id'], ['entitlements', 'contact_id'],
    ['contact_events', 'contact_id'], ['material_grants', 'contact_id']],
  companies: [['internal_notes', 'company_id']],
  events: [['contact_events', 'event_id']],
  sessions: [['internal_notes', 'session_id'], ['session_materials', 'session_id']],
  materials: [['session_materials', 'material_id'], ['material_grants', 'material_id']],
}

const today = () => new Date().toISOString().slice(0, 10)

/** In-memory store with fictional data. Resets on page reload. No network, no keys. */
export class DemoRepository implements Repository {
  readonly isDemo = true
  private data: DemoData
  constructor(seed: DemoData = demoSeed()) {
    this.data = seed
  }

  private rows<T extends TableName>(table: T): Row<T>[] {
    return this.data[table] as Row<T>[]
  }

  async list<T extends TableName>(table: T, query: Query<T> = {}): Promise<Row<T>[]> {
    const where = Object.entries(query.where ?? {})
    let out = this.rows(table).filter((r) => where.every(([k, v]) => (r as Record<string, unknown>)[k] === v))
    const col = query.order?.column ?? ('created_at' as keyof Row<T> & string)
    const dir = (query.order ? query.order.ascending ?? true : false) ? 1 : -1
    out = [...out].sort((a, b) => {
      const x = a[col], y = b[col]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
    return structuredClone(query.limit ? out.slice(0, query.limit) : out)
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const row = this.rows(table).find((r) => r.id === id)
    return row ? structuredClone(row) : null
  }

  async insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>> {
    const now = new Date().toISOString()
    const extra: Record<string, unknown> = {}
    if (table === 'charges') extra.charged_on = today()
    if (table === 'payments') extra.paid_on = today()
    if (table === 'contacts' && values && 'email' in values && values.email) {
      const email = String(values.email)
      if (this.data.contacts.some((c) => c.email === email)) throw new Error('A contact with this email already exists.')
    }
    const row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...DEFAULTS[table], ...extra, ...values } as unknown as Row<T>
    this.rows(table).push(row)
    return structuredClone(row)
  }

  async update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>> {
    const row = this.rows(table).find((r) => r.id === id)
    if (!row) throw new Error('Not found')
    Object.assign(row, patch, { updated_at: new Date().toISOString() })
    return structuredClone(row)
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    const all = this.data as unknown as Record<string, Record<string, unknown>[]>
    for (const [child, column] of CASCADES[table] ?? []) {
      if (child in CASCADES) {
        for (const r of all[child]!.filter((r) => r[column] === id)) await this.remove(child as TableName, r.id as string)
      }
      all[child] = all[child]!.filter((r) => r[column] !== id)
    }
    all[table] = all[table]!.filter((r) => r.id !== id)
  }

  async links<T extends LinkName>(table: T, where: Partial<LinkKey<T>> = {}): Promise<LinkTables[T][]> {
    const entries = Object.entries(where)
    return structuredClone((this.data[table] as LinkTables[T][]).filter((r) => entries.every(([k, v]) => (r as Record<string, unknown>)[k] === v)))
  }

  async link<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void> {
    if ((await this.links(table, key)).length) return
    ;(this.data[table] as LinkTables[T][]).push({ ...key, created_at: new Date().toISOString() } as LinkTables[T])
  }

  async unlink<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void> {
    const entries = Object.entries(key)
    const all = this.data as unknown as Record<string, Record<string, unknown>[]>
    all[table] = all[table]!.filter((r) => !entries.every(([k, v]) => r[k] === v))
  }

  async balances(): Promise<ContactBalance[]> {
    const sum = (rows: { contact_id: string | null; amount_cents: number }[], id: string) =>
      rows.filter((r) => r.contact_id === id).reduce((n, r) => n + r.amount_cents, 0)
    const paid = this.data.payments.filter((p) => p.match_status === 'matched')
    return this.data.contacts.map((c) => {
      const charged_cents = sum(this.data.charges, c.id)
      const paid_cents = sum(paid, c.id)
      return { contact_id: c.id, charged_cents, paid_cents, balance_cents: charged_cents - paid_cents }
    })
  }
}

export type { Tables }
