import { useEffect, useRef } from 'react'

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

type TurnstileApi = { render(el: HTMLElement, opts: Record<string, unknown>): string; remove(id: string): void }
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loading: Promise<void> | null = null
const load = () =>
  (loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { loading = null; reject(new Error('Could not load the security check')) }
    document.head.appendChild(s)
  }))

/** Cloudflare's bot check. Calls onToken with a token when it passes, and with null when it expires or fails. */
export function Turnstile({ onToken }: { onToken(token: string | null): void }) {
  const box = useRef<HTMLDivElement>(null)
  const cb = useRef(onToken)
  cb.current = onToken
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let id: string | undefined
    let gone = false
    load().then(() => {
      if (gone || !box.current || !window.turnstile) return
      id = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY, theme: 'auto',
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(null),
        'error-callback': () => cb.current(null),
      })
    }).catch(() => cb.current(null))
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id) }
  }, [])
  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={box} className="min-h-[65px]" />
}
