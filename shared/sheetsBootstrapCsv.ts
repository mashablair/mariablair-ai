/** Browser-local projection of the two Google Sheets export tabs, never general CSV import. */
const CONTACT_HEADERS = ['Contact ID', 'Name', 'First Met / How', 'Next Action', 'Follow-up Due'] as const
const TASK_HEADERS = ['Task ID', 'Contact ID', 'Action', 'Due Date'] as const
const MAX_FILE_LENGTH = 400_000
const MAX_LINES = 4_000
const MAX_ROWS = 200
const MAX_COLUMNS = 64
const MAX_FIELD_LENGTH = 10_000
type Tab = 'Contacts' | 'Follow-ups'
type Contact = { id: string; name: string; source: string; next_action: string; follow_up_date: string }
type Task = { id: string; contact_id: string; title: string; due_date: string }
export type SheetsBootstrapCsv = {
  contacts: Contact[]
  tasks: Task[]
  omitted: { contacts: string[]; tasks: string[] }
}

export class SheetsBootstrapCsvError extends Error {
  constructor(message: string) { super(message); this.name = 'SheetsBootstrapCsvError' }
}

function problem(tab: Tab, line: number, reason: string): never {
  throw new SheetsBootstrapCsvError(`${tab} CSV, line ${line}: ${reason}`)
}

/** Read CSV structure strictly, retaining only required values after the header. */
function project(tab: Tab, file: string, requiredHeaders: readonly string[], onRow: (line: number, cells: readonly string[]) => void): string[] {
  if (file.length > MAX_FILE_LENGTH) problem(tab, 1, 'File is too large.')
  const csv = file.charCodeAt(0) === 0xfeff ? file.slice(1) : file
  let header: string[] | undefined
  let columns: number[] = []
  let wanted = new Set<number>()
  let values: string[] = []
  let field = ''
  let fieldLength = 0
  let col = 0
  let line = 1
  let rowLine = 1
  let rows = 0
  let occupied = false
  let state: 'bare' | 'quoted' | 'closed' = 'bare'

  const nextLine = () => {
    if (++line > MAX_LINES) problem(tab, line, 'Too many physical lines.')
  }
  const add = (character: string) => {
    fieldLength += character.length
    if (fieldLength > MAX_FIELD_LENGTH) problem(tab, line, 'Field is too long.')
    if (!header || wanted.has(col)) field += character
    if (character.trim()) occupied = true
  }
  const endField = () => {
    if (++col > MAX_COLUMNS) problem(tab, line, 'Too many columns.')
    if (!header || wanted.has(col - 1)) values[col - 1] = field
    field = ''
    fieldLength = 0
    state = 'bare'
  }
  const endRow = () => {
    endField()
    if (occupied) {
      if (!header) {
        if (values.some((value) => !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value))) {
          problem(tab, rowLine, 'Column headers must be nonempty, short, single-line text.')
        }
        if (new Set(values.map((h) => h.trim())).size !== values.length) problem(tab, rowLine, 'Duplicate column header.')
        columns = requiredHeaders.map((h) => {
          const index = values.indexOf(h)
          if (index === -1) problem(tab, rowLine, `Missing required header: ${h}.`)
          return index
        })
        header = values
        wanted = new Set(columns)
      } else {
        if (++rows > MAX_ROWS) problem(tab, rowLine, 'Too many data rows.')
        if (col !== header.length) problem(tab, rowLine, 'Column count differs from the header.')
        onRow(rowLine, columns.map((i) => values[i]!))
      }
    }
    values = []
    col = 0
    occupied = false
  }

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]!
    if (state === 'quoted') {
      if (char === '"') {
        if (csv[i + 1] === '"') { add('"'); i++ }
        else state = 'closed'
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && csv[i + 1] === '\n') { add('\r\n'); i++ } else add(char)
        nextLine()
      } else add(char)
    } else if (char === ',' || char === '\r' || char === '\n') {
      if (char === ',') endField()
      else {
        endRow()
        if (char === '\r' && csv[i + 1] === '\n') i++
        if (i + 1 < csv.length) nextLine()
        rowLine = line
      }
    } else if (state === 'closed') {
      problem(tab, line, 'Unexpected text after a closing quote.')
    } else if (char === '"') {
      if (fieldLength) problem(tab, line, 'Quote inside an unquoted field.')
      state = 'quoted'
    } else {
      add(char)
    }
  }
  if ((state as string) === 'quoted') problem(tab, line, 'Unclosed quoted field.')
  if (col || occupied || fieldLength) endRow()
  if (!header) return problem(tab, 1, 'Missing header row.')
  return header.filter((_, i) => !wanted.has(i))
}

function checkedId(tab: Tab, line: number, header: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) problem(tab, line, `${header} must be a nonblank stable ID (letters, numbers, dots, underscores or hyphens).`)
  return value
}
function checkedDate(tab: Tab, line: number, header: string, value: string): string {
  const date = value.trim()
  if (date && (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    problem(tab, line, `${header} must be blank or an ISO calendar date (YYYY-MM-DD).`)
  }
  return date
}
function checkedText(tab: Tab, line: number, header: string, value: string, required = false, maxLength = 1000): string {
  const trimmed = value.trim()
  if (trimmed.includes('\0') || (header === 'Name' && /[\x00-\x1f]/.test(trimmed))) problem(tab, line, `${header} contains an unsupported character.`)
  if (trimmed.length > maxLength) problem(tab, line, `${header} exceeds ${maxLength} characters.`)
  if (required && !trimmed) problem(tab, line, `${header} is required.`)
  return trimmed
}

export function parseSheetsBootstrap(contactsCsv: string, followUpsCsv?: string): SheetsBootstrapCsv {
  const contacts: Contact[] = []
  const tasks: Task[] = []
  const contactIds = new Set<string>()
  const taskIds = new Set<string>()
  const omittedContacts = project('Contacts', contactsCsv, CONTACT_HEADERS, (line, cells) => {
    const id = checkedId('Contacts', line, 'Contact ID', cells[0]!)
    if (contactIds.has(id)) problem('Contacts', line, 'Duplicate Contact ID.')
    contactIds.add(id)
    contacts.push({ id, name: checkedText('Contacts', line, 'Name', cells[1]!, true, 200),
      source: checkedText('Contacts', line, 'First Met / How', cells[2]!),
      next_action: checkedText('Contacts', line, 'Next Action', cells[3]!),
      follow_up_date: checkedDate('Contacts', line, 'Follow-up Due', cells[4]!) })
  })
  if (!contacts.length) problem('Contacts', 1, 'A Contacts export with at least one data row is required.')
  const omittedTasks = followUpsCsv === undefined ? [] : project('Follow-ups', followUpsCsv, TASK_HEADERS, (line, cells) => {
    if (contacts.length + tasks.length >= MAX_ROWS) problem('Follow-ups', line, 'Too many total data rows across both tabs.')
    const id = checkedId('Follow-ups', line, 'Task ID', cells[0]!)
    if (taskIds.has(id)) problem('Follow-ups', line, 'Duplicate Task ID.')
    taskIds.add(id)
    const contact_id = checkedId('Follow-ups', line, 'Contact ID', cells[1]!)
    if (!contactIds.has(contact_id)) problem('Follow-ups', line, 'Contact ID must appear in the included Contacts export.')
    tasks.push({ id, contact_id, title: checkedText('Follow-ups', line, 'Action', cells[2]!, true),
      due_date: checkedDate('Follow-ups', line, 'Due Date', cells[3]!) })
  })
  return { contacts, tasks, omitted: { contacts: omittedContacts, tasks: omittedTasks } }
}
