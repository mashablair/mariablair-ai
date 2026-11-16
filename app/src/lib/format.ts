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
