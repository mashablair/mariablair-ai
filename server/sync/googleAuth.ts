// Server-only token exchange. Fixed audience/endpoint, no domain-wide delegation.
// https://developers.google.com/identity/protocols/oauth2/service-account
const endpoint = 'https://oauth2.googleapis.com/token'
const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const authError = () => new Error('Google Sheets authorization unavailable.')
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const encode = (object: object) => base64url(new TextEncoder().encode(JSON.stringify(object)))

export function createGoogleReadToken(config: {
  account: string; privateKey: string; fetch?: typeof fetch; now?: () => number
}): () => Promise<string> {
  if (!/^[A-Za-z0-9_.-]{1,200}@[A-Za-z0-9-]+\.iam\.gserviceaccount\.com$/.test(config.account)) throw authError()
  const pem = config.privateKey.replaceAll('\\n', '\n').trim()
  if (pem.length > 10_000 || !/^-----BEGIN PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]+[\r\n]+-----END PRIVATE KEY-----$/.test(pem)) throw authError()
  const fetcher = config.fetch ?? fetch
  const now = config.now ?? Date.now
  let cached: { token: string; expiration: number } | undefined
  let inFlight: Promise<string> | undefined
  async function exchange() {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), char => char.charCodeAt(0))
      const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
      const iat = Math.floor(now() / 1000)
      const assertion = encode({ alg: 'RS256', typ: 'JWT' }) + '.' +
        encode({ iss: config.account, scope, aud: endpoint, iat, exp: iat + 300 })
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(assertion))
      const res = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: assertion + '.' + base64url(new Uint8Array(signature)) }) })
      if (!res.ok || Number(res.headers.get('content-length')) > 8192) throw authError()
      const raw = await res.text()
      if (raw.length > 8192) throw authError()
      const token: unknown = JSON.parse(raw)
      if (!token || typeof token !== 'object') throw authError()
      const { access_token, expires_in, token_type } = token as Record<string, unknown>
      if (typeof access_token !== 'string' || !/^[^\s]{1,4096}$/.test(access_token)
        || typeof expires_in !== 'number' || !Number.isSafeInteger(expires_in) || expires_in <= 60 || expires_in > 3600
        || typeof token_type !== 'string' || token_type.toLowerCase() !== 'bearer') throw authError()
      cached = { token: access_token, expiration: now() + (expires_in - 45) * 1000 }
      return access_token
    } catch { throw authError() }
    finally { clearTimeout(timeout) }
  }
  return async () => {
    if (cached && cached.expiration > now()) return cached.token
    inFlight ??= exchange().finally(() => { inFlight = undefined })
    return inFlight
  }
}
