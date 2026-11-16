import { describe, expect, it } from 'vitest'
import { nextInvoiceRef, sessionAmountCents } from '../shared/billing'

describe('billing rules', () => {
  it('charges time x rate, rounded to the cent', () => {
    expect(sessionAmountCents(120, 9900)).toBe(19800)
    expect(sessionAmountCents(90, 9900)).toBe(14850)
    expect(sessionAmountCents(20, 9900)).toBe(3300)
    expect(sessionAmountCents(50, 9900)).toBe(8250)
    expect(sessionAmountCents(20, 0)).toBe(0)
    expect(sessionAmountCents(null, 9900)).toBeNull()
    expect(sessionAmountCents(60, null)).toBeNull()
  })
  it('suggests the next invoice reference', () => {
    expect(nextInvoiceRef([])).toBe('INV-0001')
    expect(nextInvoiceRef(['INV-0007', null, 'custom-12', 'inv-0003'])).toBe('INV-0008')
  })
})
