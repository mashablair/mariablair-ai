import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { STAGES, STAGE_LABELS, fullName, type Stage } from '@shared/types'
import { useList } from '@/data/hooks'
import { formatDate, today } from '@/lib/format'
import { Button, Empty, Input, LinkButton, Modal, PageHeader, Select, cx } from '@/ui/kit'
import { ContactForm } from './ContactForm'
import { Loaded, StageBadge } from './shared'

export function ContactsPage() {
  const contacts = useList('contacts', { order: { column: 'first_name' } })
  const companies = useList('companies')
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState<Stage | ''>('')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()

  const companyName = useMemo(() => new Map(companies.data?.map((c) => [c.id, c.name])), [companies.data])
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    return (contacts.data ?? []).filter((c) => {
      if (stage && c.stage !== stage) return false
      const hay = [fullName(c), c.email, c.phone, c.business_type, c.job_title, c.source, c.ai_needs, c.company_id && companyName.get(c.company_id)].join(' ').toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [contacts.data, companyName, search, stage])

  return (
    <>
      <PageHeader label="CRM" title="Contacts" actions={<>
        <LinkButton variant="outline" to="/admin/contacts/import">Import CSV</LinkButton>
        <Button onClick={() => setAdding(true)}>Add contact</Button>
      </>} />
      <div className="flex flex-wrap gap-2 mb-4">
        <Input type="search" aria-label="Search contacts" placeholder="Search name, company, email, needs…" className="flex-1 min-w-[200px]" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Filter by stage" className="!w-auto" value={stage} onChange={(e) => setStage(e.target.value as Stage | '')}>
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </Select>
      </div>
      <Loaded queries={[contacts, companies]}>{() => shown.length === 0 ? (
        <Empty>{contacts.data!.length === 0 ? 'No contacts yet. Add your first one.' : 'No contacts match.'}</Empty>
      ) : (
        <ul className="list-none p-0 m-0 border-t border-line">
          {shown.map((c) => (
            <li key={c.id} className="border-b border-line">
              <Link to={`/admin/contacts/${c.id}`} className="grid gap-x-4 gap-y-1 py-3 no-underline hover:bg-sand md:grid-cols-[1.4fr_1.2fr_200px_1.2fr] md:items-center md:px-2">
                <span className="min-w-0">
                  <span className="font-medium block truncate">{fullName(c)}</span>
                  <span className="text-sm text-muted block truncate">{[c.company_id && companyName.get(c.company_id), c.business_type].filter(Boolean).join(' · ') || c.email || c.phone}</span>
                </span>
                <span className="text-sm text-muted truncate hidden md:block">{c.email ?? c.phone}</span>
                <span><StageBadge stage={c.stage} /></span>
                <span className={cx('text-sm truncate', c.follow_up_date && c.follow_up_date <= today() ? 'text-danger' : 'text-muted')}>
                  {c.follow_up_date ? `${formatDate(c.follow_up_date)}${c.next_action ? `: ${c.next_action}` : ''}` : c.next_action}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}</Loaded>
      <p className="text-sm text-muted mt-3">{shown.length} of {contacts.data?.length ?? 0} contacts</p>
      <Modal title="Add contact" open={adding} onClose={() => setAdding(false)}>
        <ContactForm onCancel={() => setAdding(false)} onSaved={(c) => { setAdding(false); navigate(`/admin/contacts/${c.id}`) }} />
      </Modal>
    </>
  )
}
