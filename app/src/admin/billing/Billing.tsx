import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { nextInvoiceRef, sessionAmountCents } from '@shared/billing'
import { PAYMENT_METHODS, formatMoney, fullName, type Charge, type Contact, type Payment, type PaymentMethod, type Session } from '@shared/types'
import { repo } from '@/data'
import { useBalances, useList, useRemove, useWrite } from '@/data/hooks'
import { formatDate, formatDuration, fromCents, orNull, toCents, today } from '@/lib/format'
import { Badge, Button, Empty, Field, Input, Modal, Notice, PageHeader, Select, cx } from '@/ui/kit'
import { Loaded, Section } from '../crm/shared'

export const METHOD_LABELS: Record<PaymentMethod, string> = { stripe: 'Stripe', cash: 'Cash', check: 'Check', zelle: 'Zelle', card: 'Card', other: 'Other' }

function ContactSelect({ value, onChange }: { value: string; onChange(id: string): void }) {
  const contacts = useList('contacts', { order: { column: 'first_name' } })
  return (
    <Field label="Client">
      <Select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a contact…</option>
        {contacts.data?.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
      </Select>
    </Field>
  )
}

export function ChargeForm({ contactId, session, charge, onDone }: { contactId?: string; session?: Session; charge?: Charge; onDone(): void }) {
  const charges = useList('charges')
  const sessionTotal = session ? sessionAmountCents(session.duration_minutes, session.agreed_rate_cents) : null
  const [f, setF] = useState({
    contact_id: charge?.contact_id ?? session?.contact_id ?? contactId ?? '',
    description: charge?.description ?? (session ? `${session.title ?? 'AI Training Session'}${session.duration_minutes ? ` (${formatDuration(session.duration_minutes)})` : ''}` : ''),
    amount: fromCents(charge?.amount_cents ?? sessionTotal), charged_on: charge?.charged_on ?? today(),
  })
  const [invoice, setInvoice] = useState<string | undefined>(charge ? charge.invoice_ref ?? '' : undefined)
  const invoiceValue = invoice ?? (charges.data ? nextInvoiceRef(charges.data.map((c) => c.invoice_ref)) : '')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const cents = toCents(f.amount)
  const save = useWrite(() => {
    const values = { contact_id: f.contact_id, description: f.description.trim(), amount_cents: cents!, invoice_ref: orNull(invoiceValue), charged_on: f.charged_on || today() }
    return charge ? repo().update('charges', charge.id, values) : repo().insert('charges', { ...values, session_id: session?.id ?? null })
  })
  const submit = (e: FormEvent) => { e.preventDefault(); if (cents != null) save.mutate(undefined, { onSuccess: onDone }) }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {!contactId && !session && !charge && <div className="sm:col-span-2"><ContactSelect value={f.contact_id} onChange={(id) => setF((s) => ({ ...s, contact_id: id }))} /></div>}
      <div className="sm:col-span-2"><Field label="What it is for"><Input required value={f.description} onChange={set('description')} /></Field></div>
      <Field label="Amount ($)" hint={sessionTotal != null ? `Time x rate = ${formatMoney(sessionTotal)}` : undefined} error={f.amount && cents == null ? 'Enter an amount like 198 or 148.50' : null}>
        <Input required inputMode="decimal" value={f.amount} onChange={set('amount')} />
      </Field>
      <Field label="Date"><Input type="date" value={f.charged_on} onChange={set('charged_on')} /></Field>
      <Field label="Invoice reference" hint="Optional."><Input value={invoiceValue} onChange={(e) => setInvoice(e.target.value)} /></Field>
      {save.error && <div className="sm:col-span-2"><Notice tone="danger">{save.error.message}</Notice></div>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <Button variant="quiet" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{charge ? 'Save' : 'Add charge'}</Button>
      </div>
    </form>
  )
}

export function PaymentForm({ contactId, suggestedCents, onDone }: { contactId?: string; suggestedCents?: number; onDone(): void }) {
  const [f, setF] = useState({ contact_id: contactId ?? '', amount: suggestedCents && suggestedCents > 0 ? fromCents(suggestedCents) : '', method: 'zelle' as PaymentMethod, paid_on: today(), reference: '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const cents = toCents(f.amount)
  const save = useWrite(() => repo().insert('payments', {
    contact_id: f.contact_id, amount_cents: cents!, method: f.method, paid_on: f.paid_on || today(), reference: orNull(f.reference), match_status: 'matched',
  }))
  const submit = (e: FormEvent) => { e.preventDefault(); if (cents != null) save.mutate(undefined, { onSuccess: onDone }) }
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {!contactId && <div className="sm:col-span-2"><ContactSelect value={f.contact_id} onChange={(id) => setF((s) => ({ ...s, contact_id: id }))} /></div>}
      <Field label="Amount ($)" error={f.amount && cents == null ? 'Enter an amount like 198 or 148.50' : null}><Input required inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
      <Field label="How they paid">
        <Select value={f.method} onChange={set('method')}>{PAYMENT_METHODS.filter((m) => m !== 'stripe').map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}</Select>
      </Field>
      <Field label="Date"><Input type="date" value={f.paid_on} onChange={set('paid_on')} /></Field>
      <Field label="Reference" hint="Check number, Zelle note… Optional."><Input value={f.reference} onChange={set('reference')} /></Field>
      {save.error && <div className="sm:col-span-2"><Notice tone="danger">{save.error.message}</Notice></div>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <Button variant="quiet" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>Record payment</Button>
      </div>
    </form>
  )
}

function Ledger({ charges, payments, names }: { charges: Charge[]; payments: Payment[]; names?: Map<string, string> }) {
  const removeCharge = useRemove('charges')
  const removePayment = useRemove('payments')
  const [editing, setEditing] = useState<Charge | null>(null)
  const rows = useMemo(() => [
    ...charges.map((c) => ({ kind: 'charge' as const, date: c.charged_on, at: c.created_at, c })),
    ...payments.map((p) => ({ kind: 'payment' as const, date: p.paid_on, at: p.created_at, p })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at)), [charges, payments])
  if (rows.length === 0) return <Empty>No charges or payments yet.</Empty>
  return (
    <>
      <ul className="list-none p-0 m-0">
        {rows.map((r) => r.kind === 'charge' ? (
          <li key={r.c.id} className="flex flex-wrap items-center justify-between gap-x-4 py-2 border-b border-line">
            <span className="min-w-0">
              <span className="block truncate">{r.c.description}{names && <span className="text-muted"> · {names.get(r.c.contact_id)}</span>}</span>
              <span className="text-sm text-muted">Charge · {formatDate(r.c.charged_on)}{r.c.invoice_ref && ` · ${r.c.invoice_ref}`} ·{' '}
                <button type="button" className="underline cursor-pointer" onClick={() => setEditing(r.c)}>Edit</button> ·{' '}
                <button type="button" className="underline cursor-pointer" onClick={() => confirm('Delete this charge?') && removeCharge.mutate(r.c.id)}>Delete</button></span>
            </span>
            <span className="font-medium tabular-nums">{formatMoney(r.c.amount_cents)}</span>
          </li>
        ) : (
          <li key={r.p.id} className="flex flex-wrap items-center justify-between gap-x-4 py-2 border-b border-line">
            <span className="min-w-0">
              <span className="block truncate">Payment by {METHOD_LABELS[r.p.method]}{names && r.p.contact_id && <span className="text-muted"> · {names.get(r.p.contact_id)}</span>} {r.p.match_status !== 'matched' && <Badge tone="danger">Needs review</Badge>}</span>
              <span className="text-sm text-muted">{formatDate(r.p.paid_on)}{r.p.reference && ` · ${r.p.reference}`} ·{' '}
                <button type="button" className="underline cursor-pointer" onClick={() => confirm('Delete this payment record?') && removePayment.mutate(r.p.id)}>Delete</button></span>
            </span>
            <span className="font-medium tabular-nums text-ok">−{formatMoney(r.p.amount_cents)}</span>
          </li>
        ))}
      </ul>
      <Modal title="Edit charge" open={editing !== null} onClose={() => setEditing(null)}>
        {editing && <ChargeForm key={editing.id} charge={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  )
}

const BalanceLine = ({ cents }: { cents: number }) => (
  <span className={cx('font-medium', cents > 0 ? 'text-danger' : cents < 0 ? 'text-ok' : 'text-muted')}>
    {cents > 0 ? `Owes ${formatMoney(cents)}` : cents < 0 ? `Credit of ${formatMoney(-cents)}` : 'Paid up'}
  </span>
)

/** On a contact page. */
export function ContactBilling({ contact }: { contact: Contact }) {
  const charges = useList('charges', { where: { contact_id: contact.id } })
  const payments = useList('payments', { where: { contact_id: contact.id } })
  const [open, setOpen] = useState<'charge' | 'payment' | null>(null)
  const sum = (rows: { amount_cents: number }[] | undefined) => (rows ?? []).reduce((n, r) => n + r.amount_cents, 0)
  const balance = sum(charges.data) - sum(payments.data?.filter((p) => p.match_status === 'matched'))
  return (
    <Section title="Billing" actions={<span className="flex gap-2">
      <Button variant="outline" onClick={() => setOpen('charge')}>Add charge</Button>
      <Button variant="outline" onClick={() => setOpen('payment')}>Record payment</Button>
    </span>}>
      <p className="mb-2"><BalanceLine cents={balance} /></p>
      <Ledger charges={charges.data ?? []} payments={payments.data ?? []} />
      <Modal title="Add charge" open={open === 'charge'} onClose={() => setOpen(null)}>{open === 'charge' && <ChargeForm contactId={contact.id} onDone={() => setOpen(null)} />}</Modal>
      <Modal title="Record payment" open={open === 'payment'} onClose={() => setOpen(null)}>{open === 'payment' && <PaymentForm contactId={contact.id} suggestedCents={balance} onDone={() => setOpen(null)} />}</Modal>
    </Section>
  )
}

/** On a session page: turn time x rate into a charge. */
export function SessionBilling({ session }: { session: Session }) {
  const charges = useList('charges', { where: { session_id: session.id } })
  const [open, setOpen] = useState(false)
  const total = sessionAmountCents(session.duration_minutes, session.agreed_rate_cents)
  return (
    <Section title="Billing">
      {charges.data && charges.data.length > 0 ? (
        <ul className="list-none p-0 m-0">
          {charges.data.map((c) => (
            <li key={c.id} className="flex justify-between gap-4 py-2 border-b border-line">
              <span>{c.description} <span className="text-sm text-muted">· Charged {formatDate(c.charged_on)}{c.invoice_ref && ` · ${c.invoice_ref}`}</span></span>
              <span className="font-medium tabular-nums">{formatMoney(c.amount_cents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted">{total != null ? `${formatDuration(session.duration_minutes)} x ${formatMoney(session.agreed_rate_cents!)} per hour = ${formatMoney(total)}. Not charged yet.` : 'Set the length and rate to work out the charge.'}</p>
          {total != null && total > 0 && <Button variant="outline" onClick={() => setOpen(true)}>Create charge</Button>}
        </div>
      )}
      <p className="text-sm text-muted mt-2">Payments are recorded on the <Link className="underline" to={`/admin/contacts/${session.contact_id}`}>client's page</Link>.</p>
      <Modal title="Create charge" open={open} onClose={() => setOpen(false)}>{open && <ChargeForm session={session} onDone={() => setOpen(false)} />}</Modal>
    </Section>
  )
}

export function BillingPage({ reviewQueue }: { reviewQueue?: React.ReactNode }) {
  const contacts = useList('contacts')
  const charges = useList('charges')
  const payments = useList('payments')
  const balances = useBalances()
  const [open, setOpen] = useState<'charge' | 'payment' | null>(null)
  const names = useMemo(() => new Map(contacts.data?.map((c) => [c.id, fullName(c)])), [contacts.data])
  return (
    <>
      <PageHeader label="Money" title="Billing" actions={<>
        <Button variant="outline" onClick={() => setOpen('charge')}>Add charge</Button>
        <Button onClick={() => setOpen('payment')}>Record payment</Button>
      </>} />
      <Loaded queries={[contacts, charges, payments, balances]}>{() => {
        const owing = balances.data!.filter((b) => b.balance_cents !== 0).sort((a, b) => b.balance_cents - a.balance_cents)
        const totalOwed = owing.filter((b) => b.balance_cents > 0).reduce((n, b) => n + b.balance_cents, 0)
        return (
          <>
            {reviewQueue}
            <Section title="Balances">
              <p className="text-muted mb-2">{totalOwed > 0 ? `${formatMoney(totalOwed)} outstanding in total.` : 'Nobody owes anything.'}</p>
              <ul className="list-none p-0 m-0">
                {owing.map((b) => (
                  <li key={b.contact_id} className="flex justify-between gap-4 py-2 border-b border-line">
                    <Link className="underline" to={`/admin/contacts/${b.contact_id}`}>{names.get(b.contact_id) ?? 'Unknown'}</Link>
                    <BalanceLine cents={b.balance_cents} />
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Recent activity">
              <Ledger charges={charges.data!.slice(0, 30)} payments={payments.data!.filter((p) => p.match_status === 'matched').slice(0, 30)} names={names} />
            </Section>
          </>
        )
      }}</Loaded>
      <Modal title="Add charge" open={open === 'charge'} onClose={() => setOpen(null)}>{open === 'charge' && <ChargeForm onDone={() => setOpen(null)} />}</Modal>
      <Modal title="Record payment" open={open === 'payment'} onClose={() => setOpen(null)}>{open === 'payment' && <PaymentForm onDone={() => setOpen(null)} />}</Modal>
    </>
  )
}
