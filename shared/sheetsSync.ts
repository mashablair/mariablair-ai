/** Pure, deliberately narrow, three-way sync. This module never performs I/O. */
export const SYNC_FIELDS = {
  contacts: ['name', 'source', 'next_action', 'follow_up_date'],
  tasks: ['title', 'contact_id', 'due_date', 'status'],
} as const
export type SyncKind = keyof typeof SYNC_FIELDS
export type SyncRecord = { kind: SyncKind; id: string; fields: Record<string, string> }
export type SyncInput = { sheet: SyncRecord[]; app: SyncRecord[]; baseline: SyncRecord[]; binding?: string }
export type SyncChoice = 'sheet' | 'app'
export type SyncChange = {
  key: string; kind: SyncKind; id: string; field: string
  sheetValue: string; appValue: string; baseValue?: string
  direction: 'to_app' | 'to_sheet' | 'conflict'
}
export type SyncAddition = { key: string; record: SyncRecord; direction: 'to_app' | 'to_sheet' }
export type SyncWarning = { key: string; reason: 'missing_sheet' | 'missing_app' | 'missing_both' }
export type SyncPlan = { changes: SyncChange[]; additions: SyncAddition[]; warnings: SyncWarning[] }
export type SyncWrite = { kind: SyncKind; id: string; side: SyncChoice; create: boolean; fields: Record<string, string> }
export const syncKey = (r: Pick<SyncRecord, 'kind' | 'id'>) => `${r.kind}:${r.id}`

/** Reject unknown/private fields instead of accidentally returning them in a preview or write. */
export function normalizeSyncRecords(records: SyncRecord[]): SyncRecord[] {
  if (!Array.isArray(records) || records.length > 2000) throw new Error('Sync snapshot exceeds the 2000-record limit.')
  const seen = new Set<string>()
  const normalized = records.map((r) => {
    if (!r || (r.kind !== 'contacts' && r.kind !== 'tasks')) throw new Error('Invalid sync record kind.')
    if (typeof r.id !== 'string' || !r.id || r.id.length > 100 || r.id !== r.id.trim() || /[:\x00-\x1f]/.test(r.id)) throw new Error('Invalid sync record ID.')
    const key = syncKey(r)
    if (seen.has(key)) throw new Error(`Duplicate sync ID: ${key}`)
    seen.add(key)
    if (!r.fields || typeof r.fields !== 'object' || Array.isArray(r.fields)) throw new Error('Invalid sync fields.')
    const allowed: readonly string[] = SYNC_FIELDS[r.kind]
    for (const k of Object.keys(r.fields)) {
      if (!allowed.includes(k)) throw new Error(`Unsupported sync field: ${k}`)
      if (typeof r.fields[k] !== 'string' || r.fields[k]!.length > 10000) throw new Error(`Invalid sync field value: ${k}`)
    }
    const date = r.fields[r.kind === 'contacts' ? 'follow_up_date' : 'due_date'] ?? ''
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      throw new Error('Dates must be valid ISO calendar dates (YYYY-MM-DD), or empty.')
    }
    if (r.kind === 'tasks' && r.fields.status !== 'open' && r.fields.status !== 'done') {
      throw new Error('Task status must be explicitly open or done.')
    }
    return { kind: r.kind, id: r.id, fields: Object.fromEntries(allowed.map((f) => [f, r.fields[f] ?? ''])) }
  }).sort((a, b) => syncKey(a).localeCompare(syncKey(b)))
  const contactIds = new Set(normalized.filter((r) => r.kind === 'contacts').map((r) => r.id))
  for (const r of normalized) {
    if (r.kind === 'tasks' && r.fields.contact_id && !contactIds.has(r.fields.contact_id)) {
      throw new Error('Task contact ID must refer to a contact in the same snapshot.')
    }
  }
  return normalized
}

const index = (rows: SyncRecord[]) => new Map(normalizeSyncRecords(rows).map((r) => [syncKey(r), r]))

export function planSync(input: SyncInput): SyncPlan {
  const sheet = index(input.sheet), app = index(input.app), baseline = index(input.baseline)
  const plan: SyncPlan = { changes: [], additions: [], warnings: [] }
  const keys = [...new Set([...sheet.keys(), ...app.keys(), ...baseline.keys()])].sort()
  for (const key of keys) {
    const s = sheet.get(key), a = app.get(key), b = baseline.get(key)
    if (!s || !a) {
      if (b) plan.warnings.push({ key, reason: !s && !a ? 'missing_both' : !s ? 'missing_sheet' : 'missing_app' })
      else if (s) plan.additions.push({ key, record: s, direction: 'to_app' })
      else if (a) plan.additions.push({ key, record: a, direction: 'to_sheet' })
      continue
    }
    for (const field of SYNC_FIELDS[s.kind]) {
      const sv = s.fields[field]!, av = a.fields[field]!, bv = b?.fields[field]
      if (sv === av) continue
      // Before a common baseline, neither side is presumed more authoritative, even for blanks.
      const direction = !b ? 'conflict' : sv === bv ? 'to_sheet' : av === bv ? 'to_app' : 'conflict'
      plan.changes.push({ key: `${key}:${field}`, kind: s.kind, id: s.id, field, sheetValue: sv, appValue: av,
        ...(bv !== undefined ? { baseValue: bv } : {}), direction })
    }
  }
  return plan
}

/** Resolve only after preview review. Persist baseline ONLY after all writes are verified. */
export function resolveSync(input: SyncInput, choices: Record<string, SyncChoice> = {}): { writes: SyncWrite[]; baseline: SyncRecord[] } {
  const plan = planSync(input)
  const conflicts = new Set(plan.changes.filter((c) => c.direction === 'conflict').map((c) => c.key))
  for (const [key, value] of Object.entries(choices)) {
    if (!conflicts.has(key) || (value !== 'sheet' && value !== 'app')) throw new Error('Invalid conflict choice.')
  }
  for (const key of conflicts) if (!Object.hasOwn(choices, key)) throw new Error('Choose a value for every conflict before applying.')

  const s = index(input.sheet), a = index(input.app), baseline = index(input.baseline)
  const writes = new Map<string, SyncWrite>()
  for (const addition of plan.additions) {
    const side = addition.direction === 'to_app' ? 'app' : 'sheet'
    const record = { ...addition.record, fields: { ...addition.record.fields } }
    writes.set(`${side}:${addition.key}`, { kind: record.kind, id: record.id, side, create: true, fields: { ...record.fields } })
    ;(side === 'sheet' ? s : a).set(addition.key, record)
  }
  for (const change of plan.changes) {
    const useSheet = change.direction === 'to_app' || (change.direction === 'conflict' && choices[change.key] === 'sheet')
    const side: SyncChoice = useSheet ? 'app' : 'sheet'
    const value = useSheet ? change.sheetValue : change.appValue
    const key = syncKey(change)
    const writeKey = `${side}:${key}`
    const write = writes.get(writeKey) ?? { kind: change.kind, id: change.id, side, create: false, fields: {} }
    write.fields[change.field] = value
    writes.set(writeKey, write)
    ;(side === 'sheet' ? s : a).get(key)!.fields[change.field] = value
  }
  // A resolved task link must remain valid on both sides, including when a contact is missing.
  normalizeSyncRecords([...s.values()])
  normalizeSyncRecords([...a.values()])
  // Keep missing-record baselines so the next attempt does not silently treat a deletion as an addition.
  for (const [key, record] of s) {
    const other = a.get(key)
    if (other && SYNC_FIELDS[record.kind].every((f) => record.fields[f] === other.fields[f])) {
      baseline.set(key, { ...record, fields: { ...record.fields } })
    }
  }
  return { writes: [...writes.values()], baseline: normalizeSyncRecords([...baseline.values()]) }
}
