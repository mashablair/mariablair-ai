// Billing rules shared by screens and tests. Money is integer cents.

/** What a session costs: time x hourly rate, rounded to the cent. Null when either is missing. */
export function sessionAmountCents(durationMinutes: number | null, ratePerHourCents: number | null): number | null {
  if (durationMinutes == null || ratePerHourCents == null) return null
  return Math.round((durationMinutes * ratePerHourCents) / 60)
}

/** Next invoice reference after the highest one in use: INV-0007 -> INV-0008. Starts at INV-0001. */
export function nextInvoiceRef(existing: (string | null)[]): string {
  let max = 0
  for (const ref of existing) {
    const m = ref?.match(/^INV-(\d+)$/i)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `INV-${String(max + 1).padStart(4, '0')}`
}
