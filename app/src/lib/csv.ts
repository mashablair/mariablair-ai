// CSV import for contacts: parsing and column matching, kept free of UI so it can be tested.

/** RFC 4180-style parser: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export type ImportField = 'first_name' | 'last_name' | 'full_name' | 'email' | 'phone' | 'company' | 'job_title' | 'business_type' | 'source' | 'ai_needs' | 'note'
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  first_name: 'First name', last_name: 'Last name', full_name: 'Full name', email: 'Email', phone: 'Phone', company: 'Company',
  job_title: 'Job title', business_type: 'Business type', source: 'Where you met', ai_needs: 'AI needs', note: 'Private note',
}

// Header spellings seen in exports from Google Contacts, LinkedIn, Outlook and plain spreadsheets.
const HEADER_ALIASES: Record<ImportField, string[]> = {
  first_name: ['first name', 'firstname', 'first', 'given name'],
  last_name: ['last name', 'lastname', 'last', 'family name', 'surname'],
  full_name: ['name', 'full name', 'contact', 'contact name'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'e-mail 1 - value', 'email 1 - value'],
  phone: ['phone', 'phone number', 'mobile', 'mobile phone', 'cell', 'phone 1 - value'],
  company: ['company', 'company name', 'organization', 'organization name', 'organization 1 - name', 'business'],
  job_title: ['title', 'job title', 'position', 'role', 'organization title', 'organization 1 - title'],
  business_type: ['business type', 'industry', 'type of business'],
  source: ['source', 'where we met', 'met at', 'event'],
  ai_needs: ['ai needs', 'needs', 'interests'],
  note: ['note', 'notes', 'comments'],
}

/** For each column, the field it most likely holds (or null to skip it). */
export function guessColumns(header: string[]): (ImportField | null)[] {
  const used = new Set<ImportField>()
  return header.map((h) => {
    const key = h.trim().toLowerCase()
    const field = (Object.keys(HEADER_ALIASES) as ImportField[]).find((f) => !used.has(f) && HEADER_ALIASES[f].includes(key)) ?? null
    if (field) used.add(field)
    return field
  })
}

export type ImportRow = {
  first_name: string; last_name: string; email: string | null; phone: string | null; company: string | null
  job_title: string | null; business_type: string | null; source: string | null; ai_needs: string | null; note: string | null
}
export type ImportPlan = { ready: ImportRow[]; skipped: { line: number; reason: string }[] }

/** Turns raw rows into contacts to create, skipping blanks, bad emails and duplicates. */
export function planImport(rows: string[][], columns: (ImportField | null)[], existingEmails: Iterable<string>): ImportPlan {
  const seen = new Set([...existingEmails].map((e) => e.toLowerCase()))
  const plan: ImportPlan = { ready: [], skipped: [] }
  rows.forEach((cells, i) => {
    const line = i + 2 // 1-based, after the header row
    const v: Partial<Record<ImportField, string>> = {}
    columns.forEach((f, c) => { if (f && cells[c]?.trim()) v[f] = cells[c]!.trim() })
    let first = v.first_name ?? ''
    let last = v.last_name ?? ''
    if (!first && v.full_name) {
      const parts = v.full_name.split(/\s+/)
      first = parts[0] ?? ''
      last = last || parts.slice(1).join(' ')
    }
    const email = v.email ? v.email.toLowerCase() : null
    if (!first && email) first = email.split('@')[0]!
    if (!first) return void plan.skipped.push({ line, reason: 'No name or email' })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void plan.skipped.push({ line, reason: `Email looks wrong: ${email}` })
    if (email && seen.has(email)) return void plan.skipped.push({ line, reason: `Already in your contacts: ${email}` })
    if (email) seen.add(email)
    plan.ready.push({
      first_name: first, last_name: last, email, phone: v.phone ?? null, company: v.company ?? null, job_title: v.job_title ?? null,
      business_type: v.business_type ?? null, source: v.source ?? null, ai_needs: v.ai_needs ?? null, note: v.note ?? null,
    })
  })
  return plan
}
