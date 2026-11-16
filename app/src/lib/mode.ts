// Demo mode: the portfolio version. In-memory fictional data, fake sign-in, no keys.
// On for every URL under /demo, or for a whole build made with VITE_DEMO=1.
export const DEMO_BUILD = import.meta.env.VITE_DEMO === '1'
export const IS_DEMO = DEMO_BUILD || /^\/demo(\/|$)/.test(window.location.pathname)
export const ROUTER_BASENAME = !DEMO_BUILD && IS_DEMO ? '/demo' : '/'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const IS_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
