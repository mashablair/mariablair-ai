import type { AssessmentResult, SubmissionInput } from '@shared/assessmentEngine'
import { IS_DEMO } from '@/lib/mode'
import { repo } from './index'
import type { DemoRepository } from './demoRepository'

export type SubmitOutcome = { emailed: boolean; demo?: { result: AssessmentResult; contactId: string } }

/** Sends a finished assessment. Real mode: the API stores it and emails the results. Demo: stays in memory. */
export async function submitAssessment(input: SubmissionInput): Promise<SubmitOutcome> {
  if (IS_DEMO) return { emailed: false, demo: await (repo() as DemoRepository).submitAssessment(input) }
  let res: Response
  try {
    res = await fetch('/api/assessment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  } catch {
    throw new Error('We could not reach the server. Check your connection and try again.')
  }
  const data = (await res.json().catch(() => ({}))) as { emailed?: boolean; error?: string; message?: string }
  if (!res.ok) {
    throw new Error(data.error === 'not_configured' ? 'The assessment is not switched on yet. Please try again later.' : data.message ?? 'Something went wrong. Please try again.')
  }
  return { emailed: data.emailed === true }
}
