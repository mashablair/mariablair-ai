import type { SupabaseClient } from '@supabase/supabase-js'
import { materialKind, type AssessmentSubmission, type Material } from '@shared/types'
import type { ContactBalance, Insert, LinkKey, LinkName, LinkTables, Patch, Row, TableName } from '@shared/types'
import type { Query, Repository } from './repository'

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

const BUCKET = 'materials'

export class SupabaseRepository implements Repository {
  readonly isDemo = false
  constructor(private db: SupabaseClient) {}

  async list<T extends TableName>(table: T, query: Query<T> = {}): Promise<Row<T>[]> {
    let q = this.db.from(table).select('*')
    for (const [k, v] of Object.entries(query.where ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v as string)
    if (query.order) q = q.order(query.order.column, { ascending: query.order.ascending ?? true })
    else q = q.order('created_at', { ascending: false })
    if (query.limit) q = q.limit(query.limit)
    return unwrap(await q) as Row<T>[]
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    return unwrap(await this.db.from(table).select('*').eq('id', id).maybeSingle()) as Row<T> | null
  }

  async insert<T extends TableName>(table: T, values: Insert<T>): Promise<Row<T>> {
    return unwrap(await this.db.from(table).insert(values as object).select().single()) as Row<T>
  }

  async update<T extends TableName>(table: T, id: string, patch: Patch<T>): Promise<Row<T>> {
    return unwrap(await this.db.from(table).update(patch as object).eq('id', id).select().single()) as Row<T>
  }

  async remove<T extends TableName>(table: T, id: string): Promise<void> {
    unwrap(await this.db.from(table).delete().eq('id', id))
  }

  async links<T extends LinkName>(table: T, where: Partial<LinkKey<T>> = {}): Promise<LinkTables[T][]> {
    return unwrap(await this.db.from(table).select('*').match(where as Record<string, unknown>)) as LinkTables[T][]
  }

  async link<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void> {
    unwrap(await this.db.from(table).upsert(key as object, { ignoreDuplicates: true }))
  }

  async unlink<T extends LinkName>(table: T, key: LinkKey<T>): Promise<void> {
    unwrap(await this.db.from(table).delete().match(key as Record<string, unknown>))
  }

  async balances(): Promise<ContactBalance[]> {
    return unwrap(await this.db.from('contact_balances').select('*')) as ContactBalance[]
  }

  async uploadMaterial(file: File, meta: { title: string; tags: string[] }): Promise<Material> {
    // A random folder keeps paths unguessable and lets two files share a name.
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'file'
    const path = `${crypto.randomUUID()}/${safeName}`
    const up = await this.db.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (up.error) throw new Error(up.error.message)
    try {
      return await this.insert('materials', {
        title: meta.title, tags: meta.tags, storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, kind: materialKind(file.name),
      })
    } catch (err) {
      await this.db.storage.from(BUCKET).remove([path]) // do not leave an orphan file behind
      throw err
    }
  }

  async removeMaterial(material: Material): Promise<void> {
    const res = await this.db.storage.from(BUCKET).remove([material.storage_path])
    if (res.error) throw new Error(res.error.message)
    await this.remove('materials', material.id)
  }

  async materialUrl(material: Material): Promise<string> {
    const res = await this.db.storage.from(BUCKET).createSignedUrl(material.storage_path, 60, { download: material.file_name })
    if (res.error) throw new Error(res.error.message)
    return res.data.signedUrl
  }

  async myMaterials(): Promise<Material[]> {
    return unwrap(await this.db.from('materials').select('*').order('created_at', { ascending: false })) as Material[]
  }

  // Row Level Security returns only the signed-in client's own rows.
  async mySubmissions(): Promise<AssessmentSubmission[]> {
    return unwrap(await this.db.from('assessment_submissions').select('*').order('created_at', { ascending: false })) as AssessmentSubmission[]
  }
}
