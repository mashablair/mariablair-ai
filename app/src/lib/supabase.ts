import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { IS_CONFIGURED, IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './mode'

/** Null in demo mode or before the project keys are set. Only auth/ and data/ may import this. */
export const supabase: SupabaseClient | null =
  !IS_DEMO && IS_CONFIGURED ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null
