import { describe, expect, it } from 'vitest'
import { guessColumns, parseCsv, planImport } from '../app/src/lib/csv'

describe('parseCsv', () => {
  it('handles quotes, embedded commas, escaped quotes, line breaks and blank lines', () => {
    const rows = parseCsv('﻿Name,Note\r\n"Bell, Marcus","said ""hi""\nthen left"\n\nTom,ok')
    expect(rows).toEqual([['Name', 'Note'], ['Bell, Marcus', 'said "hi"\nthen left'], ['Tom', 'ok']])
  })
})

describe('guessColumns', () => {
  it('recognizes common export headers and skips unknown ones', () => {
    expect(guessColumns(['First Name', 'Last Name', 'E-mail Address', 'Mobile', 'Company', 'Birthday', 'Notes']))
      .toEqual(['first_name', 'last_name', 'email', 'phone', 'company', null, 'note'])
  })
})

describe('planImport', () => {
  const columns = guessColumns(['Name', 'Email', 'Company'])
  it('splits full names, lowercases emails and skips duplicates and bad rows', () => {
    const plan = planImport(
      [['Ana Maria Lopez', 'ANA@Example.com', 'Lopez Co'], ['', '', ''], ['Ben', 'ben@example.com', ''], ['Ben Again', 'BEN@example.com', ''],
        ['Old Friend', 'old@example.com', ''], ['Bad', 'not-an-email', ''], ['', 'solo@example.com', '']],
      columns, ['old@example.com'])
    expect(plan.ready.map((r) => [r.first_name, r.last_name, r.email, r.company])).toEqual([
      ['Ana', 'Maria Lopez', 'ana@example.com', 'Lopez Co'], ['Ben', '', 'ben@example.com', null], ['solo', '', 'solo@example.com', null]])
    expect(plan.skipped.map((s) => s.line)).toEqual([3, 5, 6, 7])
  })
})
