import { describe, expect, it } from 'vitest'
import { parseSheetsBootstrap } from '../shared/sheetsBootstrapCsv'

const CH = 'Contact ID,Name,First Met / How,Next Action,Follow-up Due'
const TH = 'Task ID,Contact ID,Action,Due Date'
const C = CH + '\nC001,Example Person,Event,Call,2026-11-20'

describe('browser-local Google Sheets bootstrap CSV projection', () => {
  it('maps only reviewed fields, preserving multiline quotes and an exact unsplit name', () => {
    const csv = '\uFEFF' + CH + ',Status,Private note\r\nC001,"  Sample  Person Jr.  ","Event, Room 1","Say ""hello""\r\nthen call",2026-11-20,ignored,"ignored, too"'
    const followups = TH + ',Priority\r\nT001,C001,Call,,ignored'
    expect(parseSheetsBootstrap(csv, followups)).toEqual({
      contacts: [{ id: 'C001', name: 'Sample  Person Jr.', source: 'Event, Room 1', next_action: 'Say "hello"\r\nthen call', follow_up_date: '2026-11-20' }],
      tasks: [{ id: 'T001', contact_id: 'C001', title: 'Call', due_date: '' }],
      omitted: { contacts: ['Status', 'Private note'], tasks: ['Priority'] },
    })
  })
  it('uses exact headers regardless of order, skips truly blank lines, and permits contacts alone', () => {
    expect(parseSheetsBootstrap('\nNext Action,Name,Contact ID,Follow-up Due,First Met / How\n\n,Test Person,C002,,\n').contacts)
      .toEqual([{ id: 'C002', name: 'Test Person', source: '', next_action: '', follow_up_date: '' }])
    expect(parseSheetsBootstrap(C).tasks).toEqual([])
    expect(() => parseSheetsBootstrap(CH)).toThrow('at least one data row')
    expect(parseSheetsBootstrap(C, TH).tasks).toEqual([])
  })
  it('requires every exact header and rejects duplicate headers', () => {
    expect(() => parseSheetsBootstrap(CH.replace('Name', 'name'))).toThrow('Missing required header: Name')
    expect(() => parseSheetsBootstrap(CH + ',Name')).toThrow('Duplicate column header')
    expect(() => parseSheetsBootstrap(CH + ',Name ')).toThrow('Duplicate column header')
    expect(() => parseSheetsBootstrap(C, TH.replace('Action', 'Todo'))).toThrow('Missing required header: Action')
  })
  it('rejects malformed quotes even in ignored columns without exposing values', () => {
    const examples = [
      CH + '\nC001,Private"x,Event,Call,',
      CH + '\nC001,"Private"x,Event,Call,',
      CH + '\nC001,"Private,Event,Call,',
      CH + ',Ignored\nC001,Test,Event,Call,,Private"x',
    ]
    for (const csv of examples) {
      expect(() => parseSheetsBootstrap(csv)).toThrow(/^Contacts CSV, line 2:/)
      expect(() => parseSheetsBootstrap(csv)).not.toThrow(/Private/)
    }
  })
  it('reports physical line numbers after multiline or blank rows', () => {
    expect(() => parseSheetsBootstrap(CH + '\r\nC001,Example,"Place\r\nRoom",,\r\n\r\nC001,Private,,,'))
      .toThrow('Contacts CSV, line 5: Duplicate Contact ID.')
  })
  it('checks valid dates and does not infer ambiguous or impossible dates', () => {
    for (const date of ['11/20/2026', '2026-2-03', '2025-02-29', '2026-04-31', '0000-01-01']) {
      expect(() => parseSheetsBootstrap(CH + '\nC001,Example,Event,Call,' + date)).toThrow('ISO calendar date')
    }
    expect(parseSheetsBootstrap(CH + '\nC001,Example,Event,Call,2024-02-29').contacts[0]?.follow_up_date).toBe('2024-02-29')
  })
  it('rejects missing/invalid IDs, duplicate IDs, unknown parent IDs and blank names or actions', () => {
    for (const id of ['', ' C001', 'C 001', '=C001', 'C:001', 'X'.repeat(101)]) {
      expect(() => parseSheetsBootstrap(CH + '\n' + id + ',Example,,,')).toThrow('stable ID')
    }
    expect(() => parseSheetsBootstrap(C + '\nC001,Example,,,')).toThrow('Duplicate Contact ID')
    expect(() => parseSheetsBootstrap(C, TH + '\nT001,C001,Call,\nT001,C001,Call,')).toThrow('Duplicate Task ID')
    expect(() => parseSheetsBootstrap(C, TH + '\nT001,C999,Call,')).toThrow('included Contacts export')
    expect(() => parseSheetsBootstrap(CH + '\nC001,,,,')).toThrow('Name is required')
    expect(() => parseSheetsBootstrap(C, TH + '\nT001,C001,,')).toThrow('Action is required')
  })
  it('rejects malformed widths and bounds file, line, row, column and field sizes', () => {
    expect(() => parseSheetsBootstrap(CH + '\nC001,Example')).toThrow('Column count')
    expect(() => parseSheetsBootstrap(CH + '\nC001,Example,,,,' )).toThrow('Column count')
    expect(() => parseSheetsBootstrap('x'.repeat(400_001))).toThrow('File is too large')
    expect(() => parseSheetsBootstrap(CH + '\n'.repeat(4_000) + 'C001,Example,,,')).toThrow('Too many physical lines')
    expect(() => parseSheetsBootstrap(CH + Array.from({ length: 201 }, (_, i) => '\nC' + i + ',Example,,,').join(''))).toThrow('Too many data rows')
    expect(() => parseSheetsBootstrap(CH + ',X'.repeat(66))).toThrow('Too many columns')
    expect(() => parseSheetsBootstrap(CH + '\nC001,' + 'x'.repeat(10_001) + ',,,')).toThrow('Field is too long')
    expect(() => parseSheetsBootstrap(CH + '\nC001,' + 'x'.repeat(201) + ',,,')).toThrow('Name exceeds 200 characters')
    expect(() => parseSheetsBootstrap(CH + '\nC001,Example,,' + 'x'.repeat(1001) + ',')).toThrow('Next Action exceeds 1000 characters')
    expect(() => parseSheetsBootstrap(C, TH + '\nT001,C001,' + 'x'.repeat(1001) + ',')).toThrow('Action exceeds 1000 characters')
    const tasks = TH + Array.from({ length: 200 }, (_, i) => '\nT' + i + ',C001,Call,').join('')
    expect(() => parseSheetsBootstrap(C, tasks)).toThrow('Too many total data rows across both tabs')
  })
})
