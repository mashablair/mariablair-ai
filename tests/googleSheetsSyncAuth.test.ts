import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createGoogleReadToken } from '../server/sync/googleAuth'

const account = 'sheet-reader@synthetic-project.iam.gserviceaccount.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
const clock = () => 1_790_000_000_000

describe('Google sync read-only authorization (mock network)', () => {
  it('signs a narrow, short-lived assertion with a pinned recipient and shares work within one request', async () => {
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe('https://oauth2.googleapis.com/token')
      expect(init.redirect).toBe('error')
      expect(init.method).toBe('POST')
      const [header, claims, sig] = init.body.get('assertion').split('.')
      expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
      expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: account, aud: url,
        iat: clock() / 1000, exp: clock() / 1000 + 300, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly' })
      expect(verify('RSA-SHA256', Buffer.from(header + '.' + claims), publicKey, Buffer.from(sig, 'base64url'))).toBe(true)
      return Response.json({ access_token: 'synthetic_access', expires_in: 3600, token_type: 'Bearer' })
    })
    const getToken = createGoogleReadToken({ account, privateKey: pem.replaceAll('\n', '\\n'), fetch: fetcher, now: clock })
    expect(await Promise.all([getToken(), getToken(), getToken()])).toEqual(Array(3).fill('synthetic_access'))
    expect(await getToken()).toBe('synthetic_access')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed or attacker-chosen account, keys, and OAuth responses, without disclosure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('private provider payload', { status: 403 }))
    expect(() => createGoogleReadToken({ account: 'https://other.invalid', privateKey: pem, fetch: fetcher })).toThrow(/authorization unavailable/)
    expect(() => createGoogleReadToken({ account, privateKey: 'not a key', fetch: fetcher })).toThrow(/authorization unavailable/)
    expect(fetcher).not.toHaveBeenCalled()
    const token = createGoogleReadToken({ account, privateKey: pem, fetch: fetcher })
    await expect(token()).rejects.toThrow('Google Sheets authorization unavailable.')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
