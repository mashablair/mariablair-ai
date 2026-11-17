// Copies the marketing page into dist/ verbatim (it never goes through Vite)
// and adds the SPA redirects. Fails the build if the copy is not byte-identical.
import { cpSync, copyFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
if (!existsSync(join(dist, 'app', 'index.html'))) throw new Error('Run vite build first: dist/app/index.html is missing')

// Static files shipped exactly as they are in the repo.
const VERBATIM = ['index.html', 'privacy.html', '404.html', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'llms.txt']
for (const file of VERBATIM) copyFileSync(join(root, file), join(dist, file))
cpSync(join(root, 'images'), join(dist, 'images'), { recursive: true })
copyFileSync(join(root, 'scripts', '_redirects'), join(dist, '_redirects'))

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
for (const page of VERBATIM) {
  if (sha(join(root, page)) !== sha(join(dist, page))) throw new Error(`${page} copy differs from source`)
}
console.log(`assembled dist/: ${VERBATIM.join(', ')} (verbatim) + /app SPA + _redirects`)
