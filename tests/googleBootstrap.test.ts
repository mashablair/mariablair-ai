import { describe, expect, it, vi } from 'vitest'
import { googleBootstrapEnabled, googleSourceDigest, openGooglePreview, projectGoogleBootstrap, readGoogleBootstrap, sealGooglePreview } from '../server/sync/googleBootstrap'
import { previewSchema } from '../server/sync/bootstrapRoutes'
import { fictionalSnapshot, fictionalSource } from './fixtures/googleBootstrap'
const env = { SUPABASE_URL: 'https://fictional.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-key', CRM_SHEETS_SYNC_ID: 'fictional_workbook' }

describe('Google bootstrap projection and opaque previews', () => {
  it('projects both tabs without private values and exposes omitted headers', () => {
    const source = projectGoogleBootstrap(fictionalSnapshot())
    expect(source).toEqual(fictionalSource())
    expect(JSON.stringify(source)).not.toContain('OMITTED_PRIVATE_VALUE')
    expect(previewSchema.safeParse({ contacts: source.contacts, tasks: source.tasks }).success).toBe(true)
  })
  it.each(['formula', 'derived', 'hasRichContent', 'numeric', 'missing'])('rejects %s supported cells', kind => {
    const snapshot = fictionalSnapshot()
    const cell = snapshot.tabs[0]!.rows[1]!.cells[4]!
    if (kind === 'formula') cell.formula = '=TODAY()'
    if (kind === 'derived') cell.derived = true
    if (kind === 'hasRichContent') cell.hasRichContent = true
    if (kind === 'numeric') cell.value = 46000
    if (kind === 'missing') snapshot.tabs[0]!.rows[1]!.cells.splice(4, 1)
    expect(() => projectGoogleBootstrap(snapshot)).toThrow('invalid_google_import')
  })
  it('rejects missing tabs and duplicate headers', () => {
    const missing = fictionalSnapshot(); missing.tabs.pop()
    expect(() => projectGoogleBootstrap(missing)).toThrow()
    const duplicate = fictionalSnapshot(); duplicate.tabs[0]!.headers.push('Name')
    expect(() => projectGoogleBootstrap(duplicate)).toThrow()
  })
  it('binds tokens to owner, workbook and server secret, hides UUID and detects tampering', async () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const digest = await googleSourceDigest(fictionalSource())
    const token = await sealGooglePreview(env, 'admin', id, digest)
    expect(atob(token)).not.toContain(id)
    expect(await openGooglePreview(env, 'admin', token)).toMatchObject({ id, digest })
    await expect(openGooglePreview(env, 'other-admin', token)).rejects.toThrow()
    await expect(openGooglePreview({ ...env, CRM_SHEETS_SYNC_ID: 'different_workbook' }, 'admin', token)).rejects.toThrow()
    await expect(openGooglePreview({ ...env, SUPABASE_SERVICE_ROLE_KEY: 'rotated' }, 'admin', token)).rejects.toThrow()
    await expect(openGooglePreview(env, 'admin', 'AAAA' + token.slice(4))).rejects.toThrow()
  })
  it('rejects a mismatched workbook pin before any Google IO', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    try {
      await expect(readGoogleBootstrap({ ...env, CRM_SHEETS_BOOTSTRAP_CONNECTION: 'a'.repeat(64) })).rejects.toThrow('invalid_google_import')
      expect(fetcher).not.toHaveBeenCalled()
    } finally { fetcher.mockRestore() }
  })
  it('requires explicit enable, read credentials and recognized mode', () => {
    const configured = { ...env, CRM_SHEETS_GOOGLE_IMPORT_ENABLED: '1', CRM_SHEETS_SYNC_ACCOUNT: 'fictional', CRM_SHEETS_SYNC_KEY: 'fictional' }
    expect(googleBootstrapEnabled(env)).toBe(false)
    for (const mode of ['off', 'preview', 'sheet_to_app']) expect(googleBootstrapEnabled({ ...configured, CRM_SHEETS_SYNC_MODE: mode })).toBe(true)
    expect(googleBootstrapEnabled({ ...configured, CRM_SHEETS_SYNC_MODE: 'two_way' })).toBe(false)
    expect(googleBootstrapEnabled({ ...configured, CRM_SHEETS_SYNC_KEY: '' })).toBe(false)
  })
})
