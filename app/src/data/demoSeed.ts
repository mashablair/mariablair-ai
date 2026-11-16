// Fictional people and companies for the /demo version. Nothing here is real.
import { STANDARD_INTAKE } from '@shared/intake'
import type { LinkTables, Tables } from '@shared/types'

export type DemoData = { [T in keyof Tables]: Tables[T][] } & { [L in keyof LinkTables]: LinkTables[L][] }

/** The contact the demo "client view" is signed in as. */
export const DEMO_CLIENT_CONTACT_ID = 'c-1'
export const DEMO_ADMIN_EMAIL = 'demo-admin@example.com'

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
const at = (offset: number, hour = 10) => `${day(offset)}T${String(hour).padStart(2, '0')}:00:00.000Z`
const stamps = (offset: number) => ({ created_at: at(offset), updated_at: at(offset) })

export function demoSeed(): DemoData {
  const offer = (id: string, key: string, name: string, kind: Tables['offers']['kind'], price: number | null, unit: 'flat' | 'hour', description: string) => ({
    id, key, name, kind, description, price_cents: price, unit, stripe_price_id: null, stripe_payment_link_id: null,
    stripe_payment_link_url: null, active: true, ...stamps(-90),
  })
  const contact = (
    id: string, first: string, last: string, email: string | null, company: string | null, stage: Tables['contacts']['stage'],
    rest: Partial<Tables['contacts']>, created: number,
  ): Tables['contacts'] => ({
    id, company_id: company, first_name: first, last_name: last, email, phone: null, job_title: null, business_type: null,
    ai_needs: null, stage, source: null, next_action: null, follow_up_date: null, ...stamps(created), ...rest,
  })

  return {
    companies: [
      { id: 'co-1', name: 'Harbor Light Dental', business_type: 'Dental practice', website: 'harborlightdental.example', phone: '(561) 555-0142', city: 'Boca Raton', ...stamps(-60) },
      { id: 'co-2', name: 'Seagrape Property Management', business_type: 'Property management', website: null, phone: '(561) 555-0177', city: 'Delray Beach', ...stamps(-45) },
      { id: 'co-3', name: 'Palmetto Tax & Books', business_type: 'Bookkeeping', website: 'palmettobooks.example', phone: null, city: 'West Palm Beach', ...stamps(-20) },
    ],
    contacts: [
      contact('c-1', 'Elena', 'Marsh', 'elena@harborlightdental.example', 'co-1', 'active_client', {
        job_title: 'Practice owner', business_type: 'Dental practice', phone: '(561) 555-0143', source: 'Assessment',
        ai_needs: 'Patient reminders, insurance letters, staff training on ChatGPT.', next_action: 'Send session 2 recap', follow_up_date: day(-1),
      }, -58),
      contact('c-2', 'Marcus', 'Bell', 'marcus@seagrapepm.example', 'co-2', 'consultation', {
        job_title: 'Operations manager', business_type: 'Property management', source: 'Boca Chamber breakfast',
        ai_needs: 'Tenant email triage and maintenance summaries.', next_action: 'Confirm free call time', follow_up_date: day(0),
      }, -40),
      contact('c-3', 'Priya', 'Nair', 'priya@palmettobooks.example', 'co-3', 'assessment_completed', {
        job_title: 'Owner', business_type: 'Bookkeeping', source: 'Assessment',
        ai_needs: 'Wants a safe way to use AI with client financial data.', next_action: 'Email about a team workshop', follow_up_date: day(2),
      }, -6),
      contact('c-4', 'Tom', 'Okafor', 'tom.okafor@example.com', null, 'contacted', {
        source: 'Delray networking night', ai_needs: 'Retired, wants to learn AI for travel planning and writing.', next_action: 'Check in after the holidays', follow_up_date: day(12),
      }, -15),
      contact('c-5', 'Grace', 'Lindqvist', null, null, 'new', { phone: '(561) 555-0190', source: 'Delray networking night', business_type: 'Boutique owner' }, -3),
      contact('c-6', 'Daniel', 'Reyes', 'daniel@reyeslaw.example', null, 'past_client', { job_title: 'Attorney', business_type: 'Law office', source: 'Referral' }, -120),
    ],
    events: [
      { id: 'e-1', name: 'Boca Chamber breakfast', event_date: day(-41), location: 'Boca Raton', ...stamps(-41) },
      { id: 'e-2', name: 'Delray networking night', event_date: day(-15), location: 'Delray Beach', ...stamps(-15) },
    ],
    contact_events: [
      { contact_id: 'c-2', event_id: 'e-1', created_at: at(-40) },
      { contact_id: 'c-4', event_id: 'e-2', created_at: at(-15) },
      { contact_id: 'c-5', event_id: 'e-2', created_at: at(-3) },
    ],
    sessions: [
      {
        id: 's-1', contact_id: 'c-1', company_id: 'co-1', type: 'consultation', status: 'completed', title: 'Free intro call', scheduled_at: at(-50, 15),
        duration_minutes: 20, agreed_rate_cents: 0, location: 'Phone', plan: 'Understand front-desk workload.', outcomes: 'Good fit. Booked 2 hours.',
        client_visible_summary: 'We talked through where your front desk loses time and picked two tasks to start with.', ...stamps(-52),
      },
      {
        id: 's-2', contact_id: 'c-1', company_id: 'co-1', type: 'private', status: 'completed', title: 'Session 1: reminders and letters', scheduled_at: at(-30, 14),
        duration_minutes: 120, agreed_rate_cents: 9900, location: 'Harbor Light Dental office', plan: 'Set up ChatGPT Team. Build reminder and insurance-letter prompts.',
        outcomes: 'Front desk drafted 6 letters live. Needs a shared prompt library.',
        client_visible_summary: 'Your team now has saved prompts for appointment reminders and insurance appeal letters.', ...stamps(-35),
      },
      {
        id: 's-3', contact_id: 'c-1', company_id: 'co-1', type: 'private', status: 'scheduled', title: 'Session 2: prompt library', scheduled_at: at(5, 14),
        duration_minutes: 90, agreed_rate_cents: 9900, location: 'Harbor Light Dental office', plan: 'Build shared prompt library. Review privacy settings.',
        outcomes: null, client_visible_summary: null, ...stamps(-7),
      },
    ],
    internal_notes: [
      { id: 'n-1', contact_id: 'c-1', company_id: null, session_id: null, body: 'Very engaged. Office manager (Jo) is the day-to-day champion.', ...stamps(-30) },
      { id: 'n-2', contact_id: 'c-2', company_id: null, session_id: null, body: 'Met at the chamber breakfast. Skeptical of AI but drowning in tenant email.', ...stamps(-40) },
      { id: 'n-3', contact_id: null, company_id: 'co-3', session_id: null, body: 'Four bookkeepers. Good candidate for a team workshop.', ...stamps(-6) },
    ],
    tasks: [
      { id: 't-1', contact_id: 'c-3', title: 'Follow up on assessment results', due_date: day(-2), done_at: null, ...stamps(-6) },
      { id: 't-2', contact_id: 'c-1', title: 'Prepare prompt library handout', due_date: day(3), done_at: null, ...stamps(-7) },
      { id: 't-3', contact_id: null, title: 'Order new business cards', due_date: day(7), done_at: null, ...stamps(-4) },
      { id: 't-4', contact_id: 'c-2', title: 'Send chamber follow-up email', due_date: day(-38), done_at: at(-38), ...stamps(-40) },
    ],
    assessment_submissions: [
      {
        id: 'a-1', contact_id: 'c-1', version_id: null, track: 'business', score: 3, level: 'experimenting', offer_key: 'ai_training_session', created_at: at(-58),
        answers: { track: 'business', b_industry: 'health', b_team: 'small', b_time: ['email', 'paperwork'], b_use: 'tried', b_tools: ['free_chat'],
          b_data: 'yes', b_win: 'time', b_comfort: 'mixed', b_timeline: 'soon', location: 'boca' },
        recommendations: [
          { title: 'Set simple privacy rules first', body: 'Because you handle private client information, decide what may and may not be typed into an AI tool, and turn on the privacy settings in the tools you use.' },
          { title: 'Let AI draft your everyday emails', body: 'Save three or four prompts for the emails you write most: replies, follow-ups, polite reminders. You review and send.' },
          { title: 'Hand the paperwork to AI', body: 'Start with one document you handle every week and have AI do the first pass.' },
        ],
      },
    ],
    intake_templates: [{ id: 'it-1', ...STANDARD_INTAKE, active: true, ...stamps(-80) }],
    intake_responses: [
      {
        id: 'ir-1', template_id: 'it-1', contact_id: 'c-1', session_id: null, ...stamps(-48),
        answers: { goals: 'Cut the time the front desk spends on reminders and insurance letters.', tasks: 'Appointment reminders, insurance appeals, recall emails.',
          tools: 'Dentrix, Outlook, Google Calendar', ai_tools: 'ChatGPT free', devices: 'Windows laptop', sensitive: 'Patient names with treatment details.' },
      },
    ],
    recommendations: [
      { id: 'r-1', contact_id: 'c-1', submission_id: 'a-1', title: 'Set simple privacy rules first', body: 'One page: no patient names with treatment details in any AI tool. Turn off training in ChatGPT settings.', shared: true, sort_order: 1, ...stamps(-58) },
      { id: 'r-2', contact_id: 'c-1', submission_id: 'a-1', title: 'Let AI draft your everyday emails', body: 'Saved prompts for reminders, recalls and insurance appeals.', shared: true, sort_order: 2, ...stamps(-58) },
      { id: 'r-3', contact_id: 'c-1', submission_id: 'a-1', title: 'Hand the paperwork to AI', body: 'Try insurance explanation-of-benefits summaries next.', shared: false, sort_order: 3, ...stamps(-58) },
    ],
    materials: [
      { id: 'm-1', title: 'ChatGPT quick-start guide', kind: 'pdf', storage_path: 'demo/quick-start.pdf', file_name: 'chatgpt-quick-start.pdf', mime_type: 'application/pdf', size_bytes: 482000, tags: ['basics', 'handout'], ...stamps(-70) },
      { id: 'm-2', title: 'Session 1 slides: reminders and letters', kind: 'slides', storage_path: 'demo/session-1.pptx', file_name: 'session-1-reminders.pptx', mime_type: null, size_bytes: 3250000, tags: ['dental', 'slides'], ...stamps(-30) },
      { id: 'm-3', title: 'AI privacy checklist for small offices', kind: 'document', storage_path: 'demo/privacy.docx', file_name: 'ai-privacy-checklist.docx', mime_type: null, size_bytes: 88000, tags: ['privacy', 'handout'], ...stamps(-25) },
    ],
    session_materials: [{ session_id: 's-2', material_id: 'm-2', created_at: at(-30) }],
    material_grants: [
      { material_id: 'm-1', contact_id: 'c-1', created_at: at(-30) },
      { material_id: 'm-2', contact_id: 'c-1', created_at: at(-30) },
    ],
    offers: [
      offer('o-1', 'free_call', 'Free 20-minute call', 'session', 0, 'flat', 'A short call to see whether AI training is a fit.'),
      offer('o-2', 'ai_training_session', 'AI Training Session', 'session', 9900, 'hour', 'Private, in-person AI training. 1 to 10 hours.'),
      offer('o-3', 'team_workshop', 'Team workshop', 'workshop', null, 'flat', 'Hands-on AI workshop for a team, at your office.'),
      offer('o-4', 'advanced_automation', 'Advanced automation', 'session', null, 'flat', 'Custom AI workflows and automation setup.'),
    ],
    charges: [
      { id: 'ch-1', contact_id: 'c-1', session_id: 's-2', offer_id: 'o-2', description: 'Session 1: reminders and letters (2 hr)', amount_cents: 19800, invoice_ref: 'INV-0001', charged_on: day(-30), ...stamps(-30) },
      { id: 'ch-2', contact_id: 'c-6', session_id: null, offer_id: 'o-2', description: 'AI Training Session (3 hr)', amount_cents: 29700, invoice_ref: 'INV-0002', charged_on: day(-100), ...stamps(-100) },
    ],
    payments: [
      { id: 'p-1', contact_id: 'c-6', offer_id: 'o-2', amount_cents: 29700, method: 'check', paid_on: day(-95), reference: 'Check 1042', payer_email: null, payer_name: null,
        stripe_event_id: null, stripe_checkout_session_id: null, stripe_payment_intent_id: null, match_status: 'matched', ...stamps(-95) },
      { id: 'p-2', contact_id: 'c-1', offer_id: 'o-2', amount_cents: 9900, method: 'zelle', paid_on: day(-28), reference: 'Deposit', payer_email: null, payer_name: null,
        stripe_event_id: null, stripe_checkout_session_id: null, stripe_payment_intent_id: null, match_status: 'matched', ...stamps(-28) },
    ],
    entitlements: [
      { id: 'en-1', contact_id: 'c-1', offer_id: 'o-2', source: 'purchase', payment_id: 'p-2', created_at: at(-28) },
    ],
  }
}
