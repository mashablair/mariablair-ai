// The free 20-minute call request form on the marketing page.
// Maria: the wording of the two emails is here. The form itself is in index.html.
import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max)

/** What the marketing page sends to POST /api/call-request. */
export const callRequestSchema = z.object({
  name: text(160).min(1),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
  phone: text(40).optional().default(''),
  company: text(120).optional().default(''),
  message: text(2000).optional().default(''),
  turnstileToken: z.string().max(4000).optional(),
})
export type CallRequest = z.output<typeof callRequestSchema>

/** "Ana Maria Lopez" -> first "Ana", last "Maria Lopez". */
export function splitName(name: string) {
  const [first = '', ...rest] = name.trim().split(/\s+/)
  return { first_name: first, last_name: rest.join(' ') }
}

export const CALL_COPY = {
  confirmation: {
    subject: 'Thanks for reaching out',
    greeting: (firstName: string) => `Hi ${firstName},`,
    body: 'Thank you for asking about a free 20-minute call. I will reply within one business day to find a time that works for you.',
    meanwhile: 'In the meantime, you can take the free 3-minute AI assessment. It gives us a head start on the call.',
    assessmentLink: 'Take the AI assessment',
    signoff: 'If anything changes, just reply to this email. It comes straight to me.',
    signature: 'Maria Blair\nAI Consulting · Boca Raton, Delray Beach and Palm Beach County',
  },
}
