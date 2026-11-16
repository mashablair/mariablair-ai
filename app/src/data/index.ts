import { IS_DEMO } from '@/lib/mode'
import { supabase } from '@/lib/supabase'
import { DemoRepository } from './demoRepository'
import { SupabaseRepository } from './supabaseRepository'
import type { Repository } from './repository'

// The single switch between real data and the demo store.
const repository: Repository | null = IS_DEMO ? new DemoRepository() : supabase ? new SupabaseRepository(supabase) : null

export function repo(): Repository {
  if (!repository) throw new Error('Supabase is not configured')
  return repository
}
export type { Repository }
