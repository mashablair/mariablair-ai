// Row shapes for every table in supabase/migrations. Kept by hand so the demo store and the
// Supabase store share one set of types. Money is integer cents. Dates are ISO strings.

export const STAGES = ['new', 'contacted', 'assessment_completed', 'consultation', 'active_client', 'past_client', 'not_a_fit'] as const
export type Stage = (typeof STAGES)[number]
export const STAGE_LABELS: Record<Stage, string> = {
  new: 'New',
  contacted: 'Contacted',
  assessment_completed: 'Assessment completed',
  consultation: 'Consultation',
  active_client: 'Active client',
  past_client: 'Past client',
  not_a_fit: 'Not a fit',
}

export const SESSION_TYPES = ['consultation', 'private', 'workshop'] as const
export type SessionType = (typeof SESSION_TYPES)[number]
export const SESSION_TYPE_LABELS: Record<SessionType, string> = { consultation: 'Consultation', private: 'Private session', workshop: 'Workshop' }
export const SESSION_STATUSES = ['planned', 'scheduled', 'completed', 'cancelled'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const PAYMENT_METHODS = ['stripe', 'cash', 'check', 'zelle', 'card', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export type MatchStatus = 'matched' | 'needs_review' | 'unmatched'
export type OfferKind = 'session' | 'workshop' | 'digital' | 'course'
export type Track = 'business' | 'individual'

type Stamps = { created_at: string; updated_at: string }

export type Company = Stamps & {
  id: string; name: string; business_type: string | null; website: string | null; phone: string | null; city: string | null
}
export type Contact = Stamps & {
  id: string; company_id: string | null; first_name: string; last_name: string; email: string | null; phone: string | null
  job_title: string | null; business_type: string | null; ai_needs: string | null; stage: Stage; source: string | null
  next_action: string | null; follow_up_date: string | null
}
export type Profile = { user_id: string; contact_id: string | null; email: string; created_at: string }
export type NetworkingEvent = Stamps & { id: string; name: string; event_date: string | null; location: string | null }
export type ContactEvent = { contact_id: string; event_id: string; created_at: string }
export type Session = Stamps & {
  id: string; contact_id: string; company_id: string | null; type: SessionType; status: SessionStatus; title: string | null
  scheduled_at: string | null; duration_minutes: number | null; agreed_rate_cents: number | null; location: string | null
  plan: string | null; outcomes: string | null; client_visible_summary: string | null
}
export type InternalNote = Stamps & { id: string; contact_id: string | null; company_id: string | null; session_id: string | null; body: string }
export type Task = Stamps & { id: string; contact_id: string | null; title: string; due_date: string | null; done_at: string | null }
export type AssessmentVersion = { id: string; version: number; definition: unknown; created_at: string }
export type StoredRecommendation = { title: string; body: string }
export type AssessmentSubmission = {
  id: string; contact_id: string; version_id: string | null; track: Track; answers: Record<string, string | string[]>
  score: number; level: string; recommendations: StoredRecommendation[]; offer_key: string | null; created_at: string
}
export type IntakeQuestion = { id: string; label: string; help?: string; type: 'text' | 'long' | 'choice'; options?: string[] }
export type IntakeTemplate = Stamps & { id: string; name: string; description: string | null; questions: IntakeQuestion[]; active: boolean }
export type IntakeResponse = Stamps & { id: string; template_id: string | null; contact_id: string; session_id: string | null; answers: Record<string, string> }
export type Recommendation = Stamps & {
  id: string; contact_id: string; submission_id: string | null; title: string; body: string; shared: boolean; sort_order: number
}
export type Material = Stamps & {
  id: string; title: string; kind: string; storage_path: string; file_name: string; mime_type: string | null; size_bytes: number | null; tags: string[]
}
export type SessionMaterial = { session_id: string; material_id: string; created_at: string }
export type MaterialGrant = { material_id: string; contact_id: string; created_at: string }
export type Offer = Stamps & {
  id: string; key: string; name: string; kind: OfferKind; description: string | null; price_cents: number | null; unit: 'flat' | 'hour'
  stripe_price_id: string | null; stripe_payment_link_id: string | null; stripe_payment_link_url: string | null; active: boolean
}
export type Charge = Stamps & {
  id: string; contact_id: string; session_id: string | null; offer_id: string | null; description: string; amount_cents: number
  invoice_ref: string | null; charged_on: string
}
export type Payment = Stamps & {
  id: string; contact_id: string | null; offer_id: string | null; amount_cents: number; method: PaymentMethod; paid_on: string
  reference: string | null; payer_email: string | null; payer_name: string | null; stripe_event_id: string | null
  stripe_checkout_session_id: string | null; stripe_payment_intent_id: string | null; match_status: MatchStatus
}
export type Entitlement = { id: string; contact_id: string; offer_id: string; source: 'purchase' | 'grant'; payment_id: string | null; created_at: string }
export type ContactBalance = { contact_id: string; charged_cents: number; paid_cents: number; balance_cents: number }

/** Tables with a single `id` primary key, usable with the generic list/get/insert/update/remove. */
export type Tables = {
  companies: Company
  contacts: Contact
  events: NetworkingEvent
  sessions: Session
  internal_notes: InternalNote
  tasks: Task
  assessment_submissions: AssessmentSubmission
  intake_templates: IntakeTemplate
  intake_responses: IntakeResponse
  recommendations: Recommendation
  materials: Material
  offers: Offer
  charges: Charge
  payments: Payment
  entitlements: Entitlement
}
export type TableName = keyof Tables
export type Row<T extends TableName> = Tables[T]

/** Join tables (composite keys). */
export type LinkTables = { contact_events: ContactEvent; session_materials: SessionMaterial; material_grants: MaterialGrant }
export type LinkName = keyof LinkTables
export type LinkKey<T extends LinkName> = Omit<LinkTables[T], 'created_at'>

/** Columns that must be supplied on insert; everything else has a database default. */
type RequiredOnInsert = {
  companies: 'name'
  contacts: 'first_name'
  events: 'name'
  sessions: 'contact_id'
  internal_notes: 'body'
  tasks: 'title'
  assessment_submissions: 'contact_id' | 'track' | 'answers' | 'score' | 'level'
  intake_templates: 'name'
  intake_responses: 'contact_id'
  recommendations: 'contact_id' | 'title'
  materials: 'title' | 'storage_path' | 'file_name'
  offers: 'key' | 'name' | 'kind'
  charges: 'contact_id' | 'description' | 'amount_cents'
  payments: 'amount_cents'
  entitlements: 'contact_id' | 'offer_id' | 'source'
}
export type Insert<T extends TableName> = Partial<Row<T>> & Pick<Row<T>, Extract<RequiredOnInsert[T], keyof Row<T>>>
export type Patch<T extends TableName> = Partial<Omit<Row<T>, 'id' | 'created_at' | 'updated_at'>>

export const fullName = (c: Pick<Contact, 'first_name' | 'last_name'>) => `${c.first_name} ${c.last_name}`.trim()
export const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })

/** A friendly kind for a file, from its name. */
export function materialKind(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'txt', 'md', 'rtf', 'pages'].includes(ext)) return 'document'
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'spreadsheet'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'm4a', 'wav'].includes(ext)) return 'audio'
  return 'file'
}
export const MATERIAL_KIND_LABELS: Record<string, string> = {
  slides: 'Slides', pdf: 'PDF', document: 'Document', spreadsheet: 'Spreadsheet', image: 'Image', video: 'Video', audio: 'Audio', file: 'File',
}
export const formatBytes = (n: number | null) =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`
