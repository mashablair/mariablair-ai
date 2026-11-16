/** Today's date in the local time zone, as YYYY-MM-DD (the format of date columns). */
export const today = () => localDate(new Date())
export const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localDate(d)
}

/** "Nov 16" for this year, "Nov 16, 2025" otherwise. Accepts a date or a timestamp. */
export function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const d = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}
export function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  return `${formatDate(value)}, ${new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/** Empty or whitespace-only text becomes null, so the database never stores blank strings. */
export const orNull = (s: string | null | undefined) => {
  const t = (s ?? '').trim()
  return t === '' ? null : t
}

/** Timestamp <-> the value of an <input type="datetime-local">, in the local time zone. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${localDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null)

/** Dollars typed by a person <-> integer cents. Returns null for blank or invalid input. */
export const toCents = (dollars: string) => {
  const n = Number(dollars.replace(/[$,\s]/g, ''))
  return dollars.trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100)
}
export const fromCents = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2))

export const formatDuration = (minutes: number | null | undefined) => {
  if (minutes == null) return ''
  const h = Math.floor(minutes / 60), m = minutes % 60
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min'
}
