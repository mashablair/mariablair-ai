// Copies the marketing page into dist/ verbatim (it never goes through Vite)
// and adds the SPA redirects. Fails the build if the copy is not byte-identical.
import { cpSync, copyFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
if (!existsSync(join(dist, 'app', 'index.html'))) throw new Error('Run vite build first: dist/app/index.html is missing')

copyFileSync(join(root, 'index.html'), join(dist, 'index.html'))
cpSync(join(root, 'images'), join(dist, 'images'), { recursive: true })
copyFileSync(join(root, 'scripts', '_redirects'), join(dist, '_redirects'))

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
if (sha(join(root, 'index.html')) !== sha(join(dist, 'index.html'))) throw new Error('Marketing page copy differs from source')
console.log('assembled dist/: marketing page (verbatim) + /app SPA + _redirects')
