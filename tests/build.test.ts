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

describe('static pages', () => {
  it('links the privacy page from the home page footer', () => {
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('href="/privacy"')
    expect(readFileSync(join(root, 'privacy.html'), 'utf8')).toContain('<h1>Privacy policy</h1>')
  })
})

describe('search and AI crawlers', () => {
  const read = (f: string) => readFileSync(join(root, f), 'utf8')
  it('has robots rules that keep private areas out and point to the sitemap', () => {
    const robots = read('robots.txt')
    for (const path of ['/admin', '/portal', '/login', '/demo', '/api/']) expect(robots).toContain(`Disallow: ${path}`)
    expect(robots).not.toMatch(/Disallow: \/\s*$/m)
    expect(robots).toContain('Sitemap: https://mariablairai.com/sitemap.xml')
  })
  it('lists only public pages in the sitemap', () => {
    const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual(['https://mariablairai.com/', 'https://mariablairai.com/privacy'])
  })
  it('has valid structured data whose FAQ matches the visible FAQ', () => {
    const html = read('index.html')
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!)
    const faq = json['@graph'].find((n: { '@type': string }) => n['@type'] === 'FAQPage')
    expect(faq.mainEntity.length).toBeGreaterThan(3)
    for (const q of faq.mainEntity) {
      expect(html).toContain(q.name)
      expect(html).toContain(q.acceptedAnswer.text)
    }
  })
  it('keeps the 404 page out of search results', () => {
    expect(read('404.html')).toContain('<meta name="robots" content="noindex">')
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
