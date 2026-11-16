// React Query wrappers over the repository. Data volumes are small (one consultant's CRM),
// so every write simply refreshes everything on screen.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Insert, LinkKey, LinkName, Patch, TableName } from '@shared/types'
import { repo } from './index'
import type { Query } from './repository'

export function useList<T extends TableName>(table: T, query?: Query<T>, enabled = true) {
  return useQuery({ queryKey: ['rows', table, query ?? null], queryFn: () => repo().list(table, query), enabled })
}

export function useRow<T extends TableName>(table: T, id: string | undefined) {
  return useQuery({ queryKey: ['row', table, id], queryFn: () => repo().get(table, id!), enabled: Boolean(id) })
}

export function useLinks<T extends LinkName>(table: T, where?: Partial<LinkKey<T>>) {
  return useQuery({ queryKey: ['links', table, where ?? null], queryFn: () => repo().links(table, where) })
}

export function useBalances() {
  return useQuery({ queryKey: ['balances'], queryFn: () => repo().balances() })
}

/** Run any write against the repository, then refresh. */
export function useWrite<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() })
}

export const useInsert = <T extends TableName>(table: T) => useWrite((values: Insert<T>) => repo().insert(table, values))
export const useUpdate = <T extends TableName>(table: T) => useWrite(({ id, patch }: { id: string; patch: Patch<T> }) => repo().update(table, id, patch))
export const useRemove = <T extends TableName>(table: T) => useWrite((id: string) => repo().remove(table, id))
export const useLink = <T extends LinkName>(table: T) => useWrite((key: LinkKey<T>) => repo().link(table, key))
export const useUnlink = <T extends LinkName>(table: T) => useWrite((key: LinkKey<T>) => repo().unlink(table, key))
