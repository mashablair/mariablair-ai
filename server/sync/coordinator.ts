import { normalizeSyncRecords, planSync, resolveSync, syncKey, type SyncInput, type SyncRecord } from '../../shared/sheetsSync'

/** Durable implementations must persist receipts BEFORE writing to either remote. */
export type SyncCoverage = {
  linked: number
  unlinkedSheet: number
  unlinkedApp: number
  unmappedColumns: { tab: string; columns: string[] }[]
}
export type SyncPreview = { id: string; owner: string; expiresAt: number; input: SyncInput }
export type SyncReceipt = {
  id: string; owner: string; previewId: string; before: SyncInput; target: { sheet: SyncRecord[]; app: SyncRecord[]; baseline: SyncRecord[] }
  phase: 'prepared' | 'complete' | 'needs_review'
}
export interface SyncStore {
  /** Must be a durable exclusive lease; return null if held. Never use a process-local mutex in production. */
  acquire(): Promise<(() => Promise<void>) | null>
  read(): Promise<SyncInput>
  pendingReceipt(): Promise<SyncReceipt | null>
  putPreview(preview: SyncPreview): Promise<void>
  getPreview(id: string): Promise<SyncPreview | null>
  getReceipt(id: string): Promise<SyncReceipt | null>
  putReceipt(receipt: SyncReceipt): Promise<void>
  /** App adapter must atomically compare expected values, write, and record receipt in SQL. */
  writeApp(expected: SyncRecord[], target: SyncRecord[], operationId: string): Promise<void>
  /** Sheet adapter must reread IDs/values, write only mapped cells with RAW input, then verify. */
  writeSheet(expected: SyncRecord[], target: SyncRecord[], operationId: string): Promise<void>
  saveBaseline(expected: SyncRecord[], target: SyncRecord[]): Promise<void>
  /** Production commits baseline and receipt together. */
  completeReceipt?(receipt: SyncReceipt): Promise<void>
  coverage?(): SyncCoverage | undefined
}
export class SyncError extends Error {
  constructor(public code: 'busy' | 'stale' | 'expired' | 'not_found' | 'needs_review' | 'invalid', message: string) { super(message) }
}
// Canonical ordering makes row/field ordering changes irrelevant without dropping values.
export function fingerprint(records: SyncRecord[]): string {
  return JSON.stringify(records.map(r => ({ kind: r.kind, id: r.id, fields: Object.fromEntries(Object.entries(r.fields).sort(([a], [b]) => a.localeCompare(b))) }))
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)))
}
const same = (a: SyncRecord[], b: SyncRecord[]) => fingerprint(a) === fingerprint(b)
const sameInput = (a: SyncInput, b: SyncInput) => a.binding === b.binding && same(a.sheet, b.sheet) && same(a.app, b.app) && same(a.baseline, b.baseline)
function applyWrites(input: SyncInput, writes: ReturnType<typeof resolveSync>['writes']) {
  const target = { sheet: structuredClone(input.sheet), app: structuredClone(input.app) }
  for (const write of writes) {
    const rows = target[write.side]
    const found = rows.find(r => r.kind === write.kind && r.id === write.id)
    if (write.create) {
      if (found) throw new SyncError('invalid', 'Duplicate target ID.')
      rows.push({ kind: write.kind, id: write.id, fields: { ...write.fields } })
    } else {
      if (!found) throw new SyncError('invalid', 'Missing target ID.')
      Object.assign(found.fields, write.fields)
    }
  }
  return target
}
/** Preserve the old baseline for outbound fields deferred by the rollout policy.
 * A first-time row is baselined only if all its fields agree. */
function convergedBaseline(input: SyncInput, target: ReturnType<typeof applyWrites>) {
  const baseline = new Map(input.baseline.map(r => [syncKey(r), structuredClone(r)]))
  const app = new Map(target.app.map(r => [syncKey(r), r]))
  for (const row of target.sheet) {
    const key = syncKey(row), other = app.get(key)
    if (!other) continue
    const base = baseline.get(key)
    if (base) {
      for (const [field, value] of Object.entries(row.fields)) {
        if (value === other.fields[field]) base.fields[field] = value
      }
    } else if (Object.entries(row.fields).every(([field, value]) => value === other.fields[field])) {
      baseline.set(key, structuredClone(row))
    }
  }
  return normalizeSyncRecords([...baseline.values()])
}

type Policy = { allowAdditions?: boolean; allowSheetWrites?: boolean }
export class SyncCoordinator {
  constructor(private store: SyncStore, private now = () => Date.now(), private id: () => string = () => crypto.randomUUID(), private policy: Policy = {}) {}
  async pendingFor(owner: string) {
    const receipt = await this.store.pendingReceipt()
    return receipt?.owner === owner ? receipt.id : null
  }
  async preview(owner: string) {
    if (await this.store.pendingReceipt()) throw new SyncError('needs_review', 'An earlier operation needs reconciliation before another preview.')
    const input = await this.store.read()
    const plan = planSync(input)
    const preview: SyncPreview = { id: this.id(), owner, expiresAt: this.now() + 10 * 60_000, input }
    await this.store.putPreview(preview)
    return { id: preview.id, expiresAt: preview.expiresAt, plan, coverage: this.store.coverage?.() }
  }
  async apply(owner: string, previewId: string, choices: Record<string, 'sheet' | 'app'>) {
    const release = await this.store.acquire()
    if (!release) throw new SyncError('busy', 'A sync is already running.')
    try {
      // Operation identity is derived from the persisted preview, never a fresh retry ID.
      const existing = await this.store.getReceipt(previewId)
      if (existing && existing.owner !== owner) throw new SyncError('not_found', 'Preview not found.')
      if (existing?.phase === 'complete') return { status: 'complete' as const, replay: true }
      // Ambiguous writes are NEVER repeated. A read-only recovery checks both final states.
      if (existing) return await this.recover(existing)
      if (await this.store.pendingReceipt()) throw new SyncError('needs_review', 'An earlier operation needs reconciliation before another sync.')
      const preview = await this.store.getPreview(previewId)
      if (!preview || preview.owner !== owner) throw new SyncError('not_found', 'Preview not found.')
      if (this.now() > preview.expiresAt) throw new SyncError('expired', 'Preview expired. Create a new preview.')
      const current = await this.store.read()
      if (!sameInput(preview.input, current)) throw new SyncError('stale', 'Data changed since preview. Create a new preview.')
      let result: ReturnType<typeof resolveSync>
      try { result = resolveSync(current, choices) }
      catch { throw new SyncError('invalid', 'Choose a value for each conflict and check any record-link warnings.') }
      if (this.policy.allowAdditions === false && result.writes.some(write => write.create)) {
        throw new SyncError('invalid', 'Unlinked records must be reviewed before they can be synced.')
      }
      const writes = this.policy.allowSheetWrites === false ? result.writes.filter(write => write.side === 'app') : result.writes
      const sides = applyWrites(current, writes)
      const target = { ...sides, baseline: this.policy.allowSheetWrites === false ? convergedBaseline(current, sides) : result.baseline }
      const receipt: SyncReceipt = { id: previewId, owner, previewId, before: current, target, phase: 'prepared' }
      await this.store.putReceipt(receipt)
      try {
        if (!same(current.app, target.app)) await this.store.writeApp(current.app, target.app, previewId)
        if (!same(current.sheet, target.sheet)) await this.store.writeSheet(current.sheet, target.sheet, previewId)
        return await this.recover(receipt)
      } catch {
        receipt.phase = 'needs_review'
        // If acknowledgement is uncertain, the already-durable prepared receipt still blocks new writes.
        try { await this.store.putReceipt(receipt) } catch { /* do not log remote payloads */ }
        throw new SyncError('needs_review', 'Sync may be partially applied. Keep this preview and check the result before starting another sync.')
      }
    } finally {
      // Lease expiration provides recovery if release acknowledgement is lost.
      try { await release() } catch { /* do not overwrite the operation result */ }
    }
  }
  private async recover(receipt: SyncReceipt) {
    const actual = await this.store.read()
    if (actual.binding !== receipt.before.binding || !same(actual.app, receipt.target.app) || !same(actual.sheet, receipt.target.sheet)) {
      receipt.phase = 'needs_review'
      await this.store.putReceipt(receipt)
      throw new SyncError('needs_review', 'The two sides do not match the saved operation. Manual reconciliation is required; no writes were retried.')
    }
    if (this.store.completeReceipt) await this.store.completeReceipt(receipt)
    else {
      if (!same(actual.baseline, receipt.target.baseline)) await this.store.saveBaseline(receipt.before.baseline, receipt.target.baseline)
      receipt.phase = 'complete'
      await this.store.putReceipt(receipt)
    }
    return { status: 'complete' as const, replay: false }
  }
}
