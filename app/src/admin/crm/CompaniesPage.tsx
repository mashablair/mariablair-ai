import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { fullName, type Company } from '@shared/types'
import { repo } from '@/data'
import { useList, useRemove, useRow, useWrite } from '@/data/hooks'
import { orNull } from '@/lib/format'
import { Button, Empty, Field, Input, Modal, Notice, PageHeader } from '@/ui/kit'
import { ContactForm } from './ContactForm'
import { Notes } from './Notes'
import { Fact, Loaded, Section, StageBadge } from './shared'

function CompanyForm({ company, onSaved, onCancel }: { company?: Company; onSaved(c: Company): void; onCancel(): void }) {
  const [f, setF] = useState({ name: company?.name ?? '', business_type: company?.business_type ?? '', website: company?.website ?? '', phone: company?.phone ?? '', city: company?.city ?? '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const save = useWrite(() => {
    const values = { name: f.name.trim(), business_type: orNull(f.business_type), website: orNull(f.website), phone: orNull(f.phone), city: orNull(f.city) }
    return company ? repo().update('companies', company.id, values) : repo().insert('companies', values)
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onSaved }) }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Company name"><Input required autoFocus={!company} value={f.name} onChange={set('name')} /></Field></div>
      <Field label="Business type"><Input value={f.business_type} onChange={set('business_type')} /></Field>
      <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
      <Field label="Website"><Input value={f.website} onChange={set('website')} /></Field>
      <Field label="Phone"><Input type="tel" value={f.phone} onChange={set('phone')} /></Field>
      {save.error && <div className="sm:col-span-2"><Notice tone="danger">{save.error.message}</Notice></div>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{company ? 'Save' : 'Add company'}</Button>
      </div>
    </form>
  )
}

export function CompaniesPage() {
  const companies = useList('companies', { order: { column: 'name' } })
  const contacts = useList('contacts')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of contacts.data ?? []) if (c.company_id) m.set(c.company_id, (m.get(c.company_id) ?? 0) + 1)
    return m
  }, [contacts.data])
  const shown = (companies.data ?? []).filter((c) => [c.name, c.business_type, c.city].join(' ').toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <PageHeader label="CRM" title="Companies" actions={<Button onClick={() => setAdding(true)}>Add company</Button>} />
      <Input type="search" aria-label="Search companies" placeholder="Search companies…" className="mb-4" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Loaded queries={[companies, contacts]}>{() => shown.length === 0 ? <Empty>No companies {search ? 'match' : 'yet'}.</Empty> : (
        <ul className="list-none p-0 m-0 border-t border-line">
          {shown.map((c) => (
            <li key={c.id} className="border-b border-line">
              <Link to={`/admin/companies/${c.id}`} className="flex items-center justify-between gap-4 py-3 md:px-2 no-underline hover:bg-sand">
                <span className="min-w-0">
                  <span className="font-medium block truncate">{c.name}</span>
                  <span className="text-sm text-muted block truncate">{[c.business_type, c.city].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-sm text-muted whitespace-nowrap">{counts.get(c.id) ?? 0} {counts.get(c.id) === 1 ? 'contact' : 'contacts'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}</Loaded>
      <Modal title="Add company" open={adding} onClose={() => setAdding(false)}>
        <CompanyForm onCancel={() => setAdding(false)} onSaved={(c) => { setAdding(false); navigate(`/admin/companies/${c.id}`) }} />
      </Modal>
    </>
  )
}

export function CompanyPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const company = useRow('companies', id)
  const people = useList('contacts', { where: { company_id: id! }, order: { column: 'first_name' } })
  const remove = useRemove('companies')
  const [editing, setEditing] = useState(false)
  const [addingPerson, setAddingPerson] = useState(false)
  return (
    <Loaded queries={[company, people]}>{() => {
      const c = company.data
      if (!c) return <Notice>This company no longer exists. <Link className="underline" to="/admin/companies">Back to companies</Link></Notice>
      return (
        <>
          <p className="mb-2"><Link className="text-sm text-muted underline" to="/admin/companies">← Companies</Link></p>
          <PageHeader label={c.business_type ?? 'Company'} title={c.name} actions={<Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>} />
          <dl className="m-0">
            <Fact label="City">{c.city}</Fact>
            <Fact label="Phone">{c.phone && <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a>}</Fact>
            <Fact label="Website">{c.website && <a className="underline" target="_blank" rel="noopener noreferrer" href={/^https?:/.test(c.website) ? c.website : `https://${c.website}`}>{c.website}</a>}</Fact>
          </dl>
          <Section title="People" actions={<Button variant="outline" onClick={() => setAddingPerson(true)}>Add person</Button>}>
            {people.data!.length === 0 && <Empty>No contacts at this company yet.</Empty>}
            <ul className="list-none p-0 m-0">
              {people.data!.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-line">
                  <span><Link className="underline" to={`/admin/contacts/${p.id}`}>{fullName(p)}</Link>{p.job_title && <span className="text-muted">, {p.job_title}</span>}</span>
                  <StageBadge stage={p.stage} />
                </li>
              ))}
            </ul>
          </Section>
          <Notes scope={{ company_id: c.id }} />
          <Section title="Danger zone">
            <Button variant="danger" onClick={() => {
              if (confirm(`Delete ${c.name}? Its contacts are kept, without a company.`)) remove.mutate(c.id, { onSuccess: () => navigate('/admin/companies') })
            }}>Delete company</Button>
          </Section>
          <Modal title="Edit company" open={editing} onClose={() => setEditing(false)}>
            <CompanyForm company={c} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
          </Modal>
          <Modal title={`Add person at ${c.name}`} open={addingPerson} onClose={() => setAddingPerson(false)}>
            <ContactForm defaults={{ companyId: c.id }} onCancel={() => setAddingPerson(false)} onSaved={() => setAddingPerson(false)} />
          </Modal>
        </>
      )
    }}</Loaded>
  )
}
