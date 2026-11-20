import { normalizeSyncRecords, type SyncRecord } from '../../shared/sheetsSync'
import type { Env } from '../app'
import { adminClient } from '../deps'
import { createGoogleSheetsSyncReader, type GoogleSheetsSyncSnapshot } from '../googleSheetsSyncReader'
import { SyncCoordinator, type SyncCoverage, type SyncPreview, type SyncReceipt, type SyncStore } from './coordinator'
import { createGoogleReadToken } from './googleAuth'
import { projectGoogleSync, type SyncLink } from './sheetProjection'

export type ProductionSyncMode = 'off' | 'preview' | 'sheet_to_app'
const dbError = () => new Error('Sync storage unavailable.')
export function productionSyncMode(env: Env): ProductionSyncMode {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY
    || !/^[A-Za-z0-9_-]{10,200}$/.test(env.CRM_SHEETS_SYNC_ID ?? '')
    || !env.CRM_SHEETS_SYNC_ACCOUNT || !env.CRM_SHEETS_SYNC_KEY) return 'off'
  return env.CRM_SHEETS_SYNC_MODE === 'preview' || env.CRM_SHEETS_SYNC_MODE === 'sheet_to_app'
    ? env.CRM_SHEETS_SYNC_MODE : 'off'
}

type Rpc = (action: string, args?: Record<string, unknown>) => Promise<unknown>
type DbRead = { app: SyncRecord[]; baseline: SyncRecord[]; links: SyncLink[]; binding: string; unlinkedApp: number }
type SheetReader = { read(): Promise<GoogleSheetsSyncSnapshot> }
export function createDurableSyncStore(rpc: Rpc, sheets: SheetReader, syntheticWriter?: (snapshot: GoogleSheetsSyncSnapshot, expected: SyncRecord[], target: SyncRecord[]) => Promise<void>): SyncStore {
  let token: string | undefined
  let coverage: SyncCoverage | undefined
  const requestWithLease = (action: string, args: Record<string, unknown> = {}) => {
    if (!token) throw dbError()
    return rpc(action, { ...args, token })
  }
  return {
    async acquire() {
      const lease = crypto.randomUUID()
      if (await rpc('acquire', { token: lease }) !== true) return null
      token = lease
      return async () => {
        token = undefined
        await rpc('release', { token: lease })
      }
    },
    async read() {
      const reply = await rpc('read')
      if (!reply || typeof reply !== 'object') throw dbError()
      const read = reply as DbRead
      if (typeof read.binding !== 'string' || !/^[0-9a-f]{64}$/.test(read.binding) || !Number.isSafeInteger(read.unlinkedApp)
        || !Array.isArray(read.links) || read.links.length > 200) throw dbError()
      const app = normalizeSyncRecords(read.app)
      const baseline = normalizeSyncRecords(read.baseline)
      const projected = projectGoogleSync(await sheets.read(), read.links, app)
      coverage = { linked: read.links.length, unlinkedApp: read.unlinkedApp,
        unlinkedSheet: projected.unlinkedSheet, unmappedColumns: projected.unmappedColumns }
      return { app, baseline, sheet: projected.sheet, binding: read.binding }
    },
    coverage: () => coverage,
    async getPreview(id) { return await rpc('preview_get', { id }) as SyncPreview | null },
    async putPreview(preview) { await rpc('preview_put', { preview }) },
    async pendingReceipt() { return await rpc('pending') as SyncReceipt | null },
    async getReceipt(id) { return await rpc('receipt_get', { id }) as SyncReceipt | null },
    async putReceipt(receipt) { await requestWithLease('receipt_put', { receipt }) },
    async writeApp(_expected, _target, id) { await requestWithLease('app_write', { id }) },
    async writeSheet(expected, target) {
      // The production factory never passes this capability. It is used only
      // to verify ordering and recovery with local synthetic tests.
      if (!syntheticWriter) throw dbError()
      const snapshot = await sheets.read()
      await requestWithLease('lease_check')
      await syntheticWriter(snapshot, expected, target)
    },
    async saveBaseline() { throw dbError() },
    async completeReceipt(receipt) { await requestWithLease('complete', { id: receipt.id }) },
  }
}

export async function connectionKey(id: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id)))
  return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')
}
export function productionCoordinator(env: Env): SyncCoordinator | null {
  if (productionSyncMode(env) === 'off') return null
  try {
    const getAccessToken = createGoogleReadToken({ account: env.CRM_SHEETS_SYNC_ACCOUNT!, privateKey: env.CRM_SHEETS_SYNC_KEY! })
    const spreadsheetId = env.CRM_SHEETS_SYNC_ID!
    const reader = createGoogleSheetsSyncReader({ spreadsheetId, getAccessToken })
    const db = adminClient(env)
    let key: Promise<string> | undefined
    const rpc: Rpc = async (action, args = {}) => {
      key ??= connectionKey(spreadsheetId)
      try {
        const { data, error } = await db.rpc('crm_sheets_sync', { p_connection: await key, p_action: action, p_args: args })
          .abortSignal(AbortSignal.timeout(8_000))
        if (error) throw dbError()
        return data
      } catch { throw dbError() }
    }
    const store = createDurableSyncStore(rpc, reader)
    return new SyncCoordinator(store, undefined, undefined, { allowAdditions: false, allowSheetWrites: false })
  } catch { return null }
}
