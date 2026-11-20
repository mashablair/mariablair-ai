import { z } from 'zod'
import type { Env } from '../app'
import { createGoogleSheetsSyncReader, type GoogleSheetsSyncSnapshot, type SyncSheetTitle } from '../googleSheetsSyncReader'
import type { SheetsBootstrapCsv } from '../../shared/sheetsBootstrapCsv'
import { createGoogleReadToken } from './googleAuth'
import { connectionKey } from './production'

export const BOOTSTRAP_COLUMNS: Record<SyncSheetTitle, readonly string[]> = {
  Contacts: ['Contact ID', 'Name', 'First Met / How', 'Next Action', 'Follow-up Due'],
  'Follow-ups': ['Task ID', 'Contact ID', 'Action', 'Due Date'],
}
const invalid = () => new Error('invalid_google_import')
/** Project only supported literals. Never coerce formulas, serial dates or rich cells. */
export function projectGoogleBootstrap(snapshot: GoogleSheetsSyncSnapshot): SheetsBootstrapCsv {
  const result: SheetsBootstrapCsv = { contacts: [], tasks: [], omitted: { contacts: [], tasks: [] } }
  for (const title of ['Contacts', 'Follow-ups'] as const) {
    const matches = snapshot.tabs.filter(t => t.title === title)
    if (matches.length !== 1) throw invalid()
    const tab = matches[0]!
    if (new Set(tab.headers.filter(Boolean)).size !== tab.headers.filter(Boolean).length) throw invalid()
    const columns = BOOTSTRAP_COLUMNS[title].map(header => {
      const index = tab.headers.indexOf(header)
      if (index < 0) throw invalid()
      return index + 1
    })
    const kind = title === 'Contacts' ? 'contacts' : 'tasks'
    result.omitted[kind] = tab.headers.filter(h => h && !BOOTSTRAP_COLUMNS[title].includes(h))
    for (const row of tab.rows.filter(r => r.row > 1)) {
      const cells = columns.map(column => row.cells.find(c => c.column === column))
      if (cells.every(c => c && c.value === null && !c.formula && !c.derived && !c.hasRichContent)) continue
      const values = cells.map(c => {
        if (!c || c.formula || c.derived || c.hasRichContent || (c.value !== null && typeof c.value !== 'string')) throw invalid()
        return c.value ?? ''
      })
      if (kind === 'contacts') result.contacts.push({ id: values[0]!, name: values[1]!, source: values[2]!, next_action: values[3]!, follow_up_date: values[4]! })
      else result.tasks.push({ id: values[0]!, contact_id: values[1]!, title: values[2]!, due_date: values[3]! })
      if (result.contacts.length + result.tasks.length > 200) throw invalid()
    }
  }
  return result
}
export const googleBootstrapEnabled = (env: Env) => Boolean(env.CRM_SHEETS_GOOGLE_IMPORT_ENABLED === '1'
  && ['off', 'preview', 'sheet_to_app'].includes(env.CRM_SHEETS_SYNC_MODE ?? 'off')
  && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  && /^[A-Za-z0-9_-]{10,200}$/.test(env.CRM_SHEETS_SYNC_ID ?? '')
  && env.CRM_SHEETS_SYNC_ACCOUNT && env.CRM_SHEETS_SYNC_KEY
  && (!env.CRM_SHEETS_BOOTSTRAP_CONNECTION || /^[a-f0-9]{64}$/.test(env.CRM_SHEETS_BOOTSTRAP_CONNECTION)))

export async function readGoogleBootstrap(env: Env) {
  if (env.CRM_SHEETS_BOOTSTRAP_CONNECTION && env.CRM_SHEETS_BOOTSTRAP_CONNECTION !== await connectionKey(env.CRM_SHEETS_SYNC_ID!)) throw invalid()
  const reader = createGoogleSheetsSyncReader({ spreadsheetId: env.CRM_SHEETS_SYNC_ID!, columns: BOOTSTRAP_COLUMNS,
    getAccessToken: createGoogleReadToken({ account: env.CRM_SHEETS_SYNC_ACCOUNT!, privateKey: env.CRM_SHEETS_SYNC_KEY! }) })
  return projectGoogleBootstrap(await reader.read())
}

// The database preview UUID stays encrypted, so the CSV apply endpoint cannot
// bypass Google's recheck. No extra table, secret or mutable Worker state needed.
const ticketSchema = z.object({ id: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), expires: z.number().int() }).strict()
const encoder = new TextEncoder()
async function ticketKey(env: Env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw invalid()
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode('crm-google-import-v1\0' + env.SUPABASE_SERVICE_ROLE_KEY))
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
const binding = (env: Env, owner: string) => encoder.encode(JSON.stringify(['crm-google-import-v1', env.CRM_SHEETS_SYNC_ID, owner]))
export async function sealGooglePreview(env: Env, owner: string, id: string, digest: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: binding(env, owner) }, await ticketKey(env),
    encoder.encode(JSON.stringify({ id, digest, expires: Date.now() + 10 * 60_000 }))))
  return btoa(String.fromCharCode(...iv, ...encrypted))
}
export async function openGooglePreview(env: Env, owner: string, ticket: string) {
  const bytes = Uint8Array.from(atob(ticket), c => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: binding(env, owner) }, await ticketKey(env), bytes.slice(12))
  return ticketSchema.parse(JSON.parse(new TextDecoder().decode(plain)))
}
export const googleSourceDigest = (source: SheetsBootstrapCsv) => connectionKey(JSON.stringify(source))
