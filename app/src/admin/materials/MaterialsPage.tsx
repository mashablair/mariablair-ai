import { useMemo, useRef, useState, type FormEvent } from 'react'
import { MATERIAL_KIND_LABELS, formatBytes, fullName, type Contact, type Material, type Session } from '@shared/types'
import { repo } from '@/data'
import { useLink, useLinks, useList, useUnlink, useUpdate, useWrite } from '@/data/hooks'
import { formatDate } from '@/lib/format'
import { Badge, Button, Empty, Field, Input, Modal, Notice, PageHeader, Select, cx } from '@/ui/kit'
import { Loaded, Section } from '../crm/shared'

const parseTags = (s: string) => [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]

/** Opens the file through a short-lived private link. */
export function DownloadLink({ material, children }: { material: Material; children?: React.ReactNode }) {
  const [error, setError] = useState(false)
  const open = async () => {
    setError(false)
    try {
      const url = await repo().materialUrl(material)
      const a = document.createElement('a')
      a.href = url
      a.download = material.file_name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setError(true)
    }
  }
  return <button type="button" className={cx('underline cursor-pointer text-left', error && 'text-danger')} onClick={open}>{error ? 'Could not open. Try again' : children ?? 'Download'}</button>
}

export const MaterialMeta = ({ material }: { material: Material }) => (
  <span className="text-sm text-muted">{[MATERIAL_KIND_LABELS[material.kind] ?? 'File', formatBytes(material.size_bytes), formatDate(material.created_at)].filter(Boolean).join(' · ')}</span>
)

function UploadForm({ onDone }: { onDone(): void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const upload = useWrite(() => repo().uploadMaterial(file!, { title: title.trim() || file!.name, tags: parseTags(tags) }))
  const submit = (e: FormEvent) => { e.preventDefault(); if (file) upload.mutate(undefined, { onSuccess: onDone }) }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="File" hint="PowerPoint, PDF, Word, images, anything. Up to 50 MB.">
        <input ref={input} type="file" required onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')) }}
          className="block w-full border border-line p-2 file:mr-3 file:border-0 file:bg-btn file:text-btn-ink file:px-3 file:py-2 file:cursor-pointer" />
      </Field>
      <Field label="Title"><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Tags" hint="Separate with commas. For example: basics, handout, dental."><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
      {upload.error && <Notice tone="danger">Upload failed: {upload.error.message}</Notice>}
      <div className="flex gap-2 justify-end">
        <Button variant="quiet" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={upload.isPending || !file}>{upload.isPending ? 'Uploading…' : 'Upload'}</Button>
      </div>
    </form>
  )
}

function MaterialEditor({ material, onDone }: { material: Material; onDone(): void }) {
  const contacts = useList('contacts', { order: { column: 'first_name' } })
  const grants = useLinks('material_grants', { material_id: material.id })
  const update = useUpdate('materials')
  const grant = useLink('material_grants')
  const revoke = useUnlink('material_grants')
  const del = useWrite(() => repo().removeMaterial(material))
  const [title, setTitle] = useState(material.title)
  const [tags, setTags] = useState(material.tags.join(', '))
  const granted = new Set(grants.data?.map((g) => g.contact_id))
  const save = (e: FormEvent) => { e.preventDefault(); update.mutate({ id: material.id, patch: { title: title.trim(), tags: parseTags(tags) } }, { onSuccess: onDone }) }
  return (
    <div className="grid gap-5">
      <form onSubmit={save} className="grid gap-4">
        <Field label="Title"><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Tags" hint="Separate with commas."><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <div className="flex gap-2 justify-end"><Button type="submit" disabled={update.isPending}>Save</Button></div>
      </form>
      <div>
        <h3 className="text-2xl mb-1">Who can download it</h3>
        <p className="text-sm text-muted mb-2">Clients see a file in their account only when they are listed here.</p>
        <ul className="list-none p-0 m-0">
          {contacts.data?.filter((c) => granted.has(c.id)).map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5 border-b border-line">
              <span>{fullName(c)}</span>
              <button type="button" className="underline text-sm cursor-pointer" onClick={() => revoke.mutate({ material_id: material.id, contact_id: c.id })}>Remove access</button>
            </li>
          ))}
        </ul>
        {granted.size === 0 && <p className="text-muted text-[15px]">Nobody yet. Only you can see this file.</p>}
        <Select aria-label="Give a contact access" className="mt-3" value="" onChange={(e) => e.target.value && grant.mutate({ material_id: material.id, contact_id: e.target.value })}>
          <option value="">Give access to…</option>
          {contacts.data?.filter((c) => !granted.has(c.id)).map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
        </Select>
      </div>
      <div className="border-t border-line pt-4">
        {del.error && <Notice tone="danger">{del.error.message}</Notice>}
        <Button variant="danger" disabled={del.isPending} onClick={() => confirm(`Delete "${material.title}" for good? Clients lose access too.`) && del.mutate(undefined, { onSuccess: onDone })}>Delete file</Button>
      </div>
    </div>
  )
}

export function MaterialsPage() {
  const materials = useList('materials')
  const grants = useLinks('material_grants')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const allTags = useMemo(() => [...new Set((materials.data ?? []).flatMap((m) => m.tags))].sort(), [materials.data])
  const grantCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of grants.data ?? []) m.set(g.material_id, (m.get(g.material_id) ?? 0) + 1)
    return m
  }, [grants.data])
  const shown = (materials.data ?? []).filter((m) => (!tag || m.tags.includes(tag)) && [m.title, m.file_name, ...m.tags].join(' ').toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <PageHeader label="Work" title="Materials" actions={<Button onClick={() => setUploading(true)}>Upload file</Button>} />
      <div className="flex flex-wrap gap-2 mb-4">
        <Input type="search" aria-label="Search materials" placeholder="Search title, file name, tag…" className="flex-1 min-w-[200px]" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Filter by tag" className="!w-auto" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>
      <Loaded queries={[materials, grants]}>{() => shown.length === 0 ? <Empty>{materials.data!.length === 0 ? 'Your library is empty. Upload your first file.' : 'No files match.'}</Empty> : (
        <ul className="list-none p-0 m-0 border-t border-line">
          {shown.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 border-b border-line">
              <div className="min-w-0">
                <p className="font-medium truncate">{m.title}</p>
                <p className="truncate"><MaterialMeta material={m} /></p>
                <p className="flex flex-wrap gap-1 mt-1">
                  {m.tags.map((t) => <button key={t} type="button" className="cursor-pointer" onClick={() => setTag(t)}><Badge>{t}</Badge></button>)}
                  <Badge tone={grantCount.get(m.id) ? 'ok' : 'neutral'}>{grantCount.get(m.id) ? `Shared with ${grantCount.get(m.id)}` : 'Private'}</Badge>
                </p>
              </div>
              <div className="flex items-center gap-4">
                <DownloadLink material={m} />
                <Button variant="outline" onClick={() => setEditing(m)}>Manage</Button>
              </div>
            </li>
          ))}
        </ul>
      )}</Loaded>
      <Modal title="Upload a file" open={uploading} onClose={() => setUploading(false)}>
        {uploading && <UploadForm onDone={() => setUploading(false)} />}
      </Modal>
      <Modal title="Manage file" open={editing !== null} onClose={() => setEditing(null)}>
        {editing && <MaterialEditor key={editing.id} material={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  )
}

/** On a session page: attach files from the library and share them with the client in one tap. */
export function SessionMaterials({ session }: { session: Session }) {
  const materials = useList('materials', { order: { column: 'title' } })
  const attached = useLinks('session_materials', { session_id: session.id })
  const grants = useLinks('material_grants', { contact_id: session.contact_id })
  const attach = useLink('session_materials')
  const detach = useUnlink('session_materials')
  const grant = useLink('material_grants')
  const revoke = useUnlink('material_grants')
  const attachedIds = new Set(attached.data?.map((a) => a.material_id))
  const grantedIds = new Set(grants.data?.map((g) => g.material_id))
  const list = (materials.data ?? []).filter((m) => attachedIds.has(m.id))
  const rest = (materials.data ?? []).filter((m) => !attachedIds.has(m.id))
  return (
    <Section title="Materials">
      {list.length === 0 && <Empty>No files attached to this session.</Empty>}
      <ul className="list-none p-0 m-0">
        {list.map((m) => {
          const shared = grantedIds.has(m.id)
          const key = { material_id: m.id, contact_id: session.contact_id }
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 border-b border-line">
              <span className="min-w-0"><DownloadLink material={m}>{m.title}</DownloadLink> <MaterialMeta material={m} /></span>
              <span className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" className="size-5 accent-[var(--brass)]" checked={shared} onChange={() => (shared ? revoke.mutate(key) : grant.mutate(key))} />
                  Client can download
                </label>
                <button type="button" aria-label={`Detach ${m.title}`} className="text-muted hover:text-danger px-2 cursor-pointer text-base" onClick={() => detach.mutate({ session_id: session.id, material_id: m.id })}>×</button>
              </span>
            </li>
          )
        })}
      </ul>
      {rest.length > 0 && (
        <Select aria-label="Attach a file" className="!w-auto mt-3 max-w-full" value="" onChange={(e) => e.target.value && attach.mutate({ session_id: session.id, material_id: e.target.value })}>
          <option value="">Attach a file from the library…</option>
          {rest.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </Select>
      )}
    </Section>
  )
}

/** On a contact page: every file this client can download. */
export function ContactMaterials({ contact }: { contact: Contact }) {
  const materials = useList('materials', { order: { column: 'title' } })
  const grants = useLinks('material_grants', { contact_id: contact.id })
  const grant = useLink('material_grants')
  const revoke = useUnlink('material_grants')
  const grantedIds = new Set(grants.data?.map((g) => g.material_id))
  const list = (materials.data ?? []).filter((m) => grantedIds.has(m.id))
  const rest = (materials.data ?? []).filter((m) => !grantedIds.has(m.id))
  if ((materials.data ?? []).length === 0) return null
  return (
    <Section title="Shared materials">
      {list.length === 0 && <Empty>No files shared with this client.</Empty>}
      <ul className="list-none p-0 m-0">
        {list.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 py-2 border-b border-line">
            <span className="min-w-0"><DownloadLink material={m}>{m.title}</DownloadLink> <MaterialMeta material={m} /></span>
            <button type="button" className="underline text-sm cursor-pointer" onClick={() => revoke.mutate({ material_id: m.id, contact_id: contact.id })}>Remove access</button>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <Select aria-label="Share a file" className="!w-auto mt-3 max-w-full" value="" onChange={(e) => e.target.value && grant.mutate({ material_id: e.target.value, contact_id: contact.id })}>
          <option value="">Share a file…</option>
          {rest.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </Select>
      )}
    </Section>
  )
}
