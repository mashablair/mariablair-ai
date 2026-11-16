import type { IntakeQuestion } from './types'

/** A ready-made intake form Maria can start from and then edit. */
export const STANDARD_INTAKE: { name: string; description: string; questions: IntakeQuestion[] } = {
  name: 'New client intake',
  description: 'Asked before the first paid session.',
  questions: [
    { id: 'goals', label: 'What do you most want to get out of our sessions?', type: 'long' },
    { id: 'tasks', label: 'Which tasks take the most time each week?', type: 'long' },
    { id: 'tools', label: 'Which software do you use every day?', help: 'Email, calendar, accounting, practice management…', type: 'long' },
    { id: 'ai_tools', label: 'Which AI tools do you already have?', type: 'text' },
    { id: 'devices', label: 'What will you use in our sessions?', type: 'choice', options: ['Windows laptop', 'Mac', 'iPad or tablet', 'Phone only'] },
    { id: 'sensitive', label: 'Is there information that must never go into an AI tool?', type: 'long' },
    { id: 'people', label: 'Who else will join the sessions?', type: 'text' },
  ],
}
