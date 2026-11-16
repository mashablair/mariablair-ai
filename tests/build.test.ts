import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from '../server/app'

const root = join(import.meta.dirname, '..')

describe('routing config', () => {
  it('sends every SPA route in the plan to the app shell', () => {
    const redirects = readFileSync(join(root, 'scripts/_redirects'), 'utf8')
    for (const route of ['/assessment/*', '/admin/*', '/portal/*', '/login', '/demo/*']) {
      expect(redirects).toContain(`${route} /app/ 200`)
    }
  })
})

describe('api', () => {
  it('answers the health check', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, configured: { database: false } })
  })
  it('returns JSON 404s', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
  })
})
