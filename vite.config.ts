import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

const repoRoot = import.meta.dirname

// Dev only: serve the untouched marketing page at "/" and its photos at "/images/*",
// the same way production does, so links between the two can be tried locally.
function marketingPage(): Plugin {
  return {
    name: 'marketing-page',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? ''
        const page = path === '/' ? 'index.html' : path === '/privacy' ? 'privacy.html' : null
        if (page) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          createReadStream(join(repoRoot, page)).pipe(res)
          return
        }
        if (path.startsWith('/images/')) {
          const file = normalize(join(repoRoot, decodeURIComponent(path)))
          if (file.startsWith(join(repoRoot, 'images')) && existsSync(file) && statSync(file).isFile()) {
            res.setHeader('Content-Type', 'image/jpeg')
            createReadStream(file).pipe(res)
            return
          }
        }
        next()
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  root: 'app',
  // Production: the SPA lives under /app/ next to the marketing page. Dev: served from "/".
  base: command === 'build' ? '/app/' : '/',
  envDir: repoRoot,
  plugins: [marketingPage(), react(), tailwindcss()],
  resolve: { alias: { '@shared': join(repoRoot, 'shared'), '@': join(repoRoot, 'app/src') } },
  build: { outDir: '../dist/app', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8788' } },
  test: { root: repoRoot, include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], testTimeout: 30000 },
}))
