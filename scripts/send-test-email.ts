// Sends one sample results email through Resend, to check delivery and how it looks.
// Run: npx vite-node scripts/send-test-email.ts you@example.com
import { readFileSync } from 'node:fs'
import { realDeps } from '../server/deps'
import { resultsEmail } from '../server/email'
import type { Env } from '../server/app'
import { questionsFor, scoreAssessment, type Answers } from '../shared/assessmentEngine'

const env: Record<string, string> = {}
for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]!] = m[2]!.replace(/^"|"$/g, '')
}
const to = process.argv[2]
if (!to) throw new Error('Pass the address to send to')

const answers: Answers = { track: 'business' }
for (const q of questionsFor('business')) if (q.id !== 'track') answers[q.id] = q.type === 'multi' ? [q.options[0]!.id] : q.options[1]!.id
const result = scoreAssessment(answers)
await realDeps.sendEmail(env as unknown as Env, resultsEmail(to, 'Maria', result, 'https://mariablairai.com'))
console.log(`sent sample "${result.levelName}" results email to ${to}`)
