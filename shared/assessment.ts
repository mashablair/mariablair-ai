// =============================================================================
// THE ASSESSMENT: every question, score, result and sentence lives in this file.
// Maria: you can edit any wording between quotes. Rules of thumb:
//   - Change text freely (title, help, label, body).
//   - Do not change an `id` once people have taken the assessment (old answers refer to it).
//   - `points` feed the score. `tags` switch recommendations on (see RECOMMENDATIONS below).
//   - If you add, remove or re-score questions, raise ASSESSMENT_VERSION by 1.
// =============================================================================

export const ASSESSMENT_VERSION = 1

export type Track = 'business' | 'individual'
export type LevelKey = 'curious' | 'experimenting' | 'systemize'
export type OfferKey = 'free_call' | 'ai_training_session' | 'team_workshop' | 'advanced_automation'

export type Option = { id: string; label: string; points?: number; tags?: string[]; /** Picking this clears the other choices. */ exclusive?: boolean }
export type Question = {
  id: string
  /** Who sees it. */
  track: Track | 'both'
  title: string
  help?: string
  /** single = pick one. multi = pick several (the score counts the highest-scoring pick). */
  type: 'single' | 'multi'
  /** multi only: the most choices allowed. */
  max?: number
  options: Option[]
}

/** The first question decides which track the rest of the questions follow. */
export const TRACK_QUESTION_ID = 'track'

export const QUESTIONS: Question[] = [
  {
    id: TRACK_QUESTION_ID, track: 'both', type: 'single',
    title: 'Which sounds more like you?',
    options: [
      { id: 'business', label: 'I run a business or lead a team' },
      { id: 'individual', label: "I'm learning AI for myself" },
    ],
  },

  // ----------------------------- Business track -----------------------------
  {
    id: 'b_industry', track: 'business', type: 'single',
    title: 'What kind of business is it?',
    options: [
      { id: 'professional', label: 'Professional services (law, accounting, consulting)' },
      { id: 'health', label: 'Medical, dental or wellness' },
      { id: 'real_estate', label: 'Real estate or property management' },
      { id: 'home_services', label: 'Home services or trades' },
      { id: 'retail', label: 'Retail, restaurant or hospitality' },
      { id: 'other', label: 'Something else' },
    ],
  },
  {
    id: 'b_team', track: 'business', type: 'single',
    title: 'How many people work in the business?',
    options: [
      { id: 'solo', label: 'Just me', tags: ['solo'] },
      { id: 'small', label: '2 to 5' },
      { id: 'medium', label: '6 to 15', tags: ['team'] },
      { id: 'large', label: 'More than 15', tags: ['team'] },
    ],
  },
  {
    id: 'b_time', track: 'business', type: 'multi', max: 3,
    title: 'Where does the most time go each week?',
    help: 'Pick up to three.',
    options: [
      { id: 'email', label: 'Email and messages', tags: ['t_email'] },
      { id: 'scheduling', label: 'Scheduling and follow-ups', tags: ['t_scheduling'] },
      { id: 'writing', label: 'Writing: proposals, letters, posts', tags: ['t_writing'] },
      { id: 'paperwork', label: 'Paperwork and data entry', tags: ['t_paperwork'] },
      { id: 'customers', label: 'Answering the same customer questions', tags: ['t_customers'] },
      { id: 'marketing', label: 'Marketing and social media', tags: ['t_marketing'] },
    ],
  },
  {
    id: 'b_use', track: 'business', type: 'single',
    title: 'How much does your business use AI today?',
    options: [
      { id: 'none', label: 'Not at all', points: 0 },
      { id: 'tried', label: 'A few of us have tried it', points: 1 },
      { id: 'weekly', label: 'Some of us use it every week', points: 2 },
      { id: 'daily', label: "It's part of our daily work", points: 3 },
    ],
  },
  {
    id: 'b_tools', track: 'business', type: 'multi',
    title: 'Which AI tools do you already have?',
    help: 'Pick all that apply.',
    options: [
      { id: 'paid_chat', label: 'ChatGPT or Claude, paid plan', points: 2, tags: ['paid_ai'] },
      { id: 'free_chat', label: 'ChatGPT or Claude, free version', points: 1 },
      { id: 'copilot', label: 'Microsoft Copilot (in Word, Outlook, Teams)', points: 2, tags: ['paid_ai'] },
      { id: 'gemini', label: 'Google Gemini (in Gmail, Docs)', points: 2, tags: ['paid_ai'] },
      { id: 'built_in', label: 'AI features inside software we already use', points: 1 },
      { id: 'none', label: 'None yet', points: 0, exclusive: true },
    ],
  },
  {
    id: 'b_data', track: 'business', type: 'single',
    title: 'Do you handle sensitive client information?',
    help: 'For example health, financial or legal records.',
    options: [
      { id: 'yes', label: 'Yes, every day', tags: ['sensitive'] },
      { id: 'some', label: 'Some private customer details', tags: ['sensitive'] },
      { id: 'no', label: 'Not really' },
      { id: 'unsure', label: "I'm not sure", tags: ['sensitive'] },
    ],
  },
  {
    id: 'b_win', track: 'business', type: 'single',
    title: 'What would be the biggest win?',
    options: [
      { id: 'time', label: 'Getting hours back every week', tags: ['w_time'] },
      { id: 'customers', label: 'Answering customers faster', tags: ['w_customers'] },
      { id: 'marketing', label: 'Better marketing and more leads', tags: ['w_marketing'] },
      { id: 'team', label: 'My whole team using AI well', tags: ['w_team'] },
      { id: 'automation', label: 'A process that runs itself from start to finish', tags: ['w_automation'] },
    ],
  },
  {
    id: 'b_comfort', track: 'business', type: 'single',
    title: 'How do you feel about using AI yourself?',
    options: [
      { id: 'new', label: "I haven't really tried it", points: 0 },
      { id: 'mixed', label: "I've tried it, results were hit or miss", points: 1 },
      { id: 'regular', label: 'I use it often and get good results', points: 2 },
      { id: 'teach', label: 'I could teach other people', points: 3 },
    ],
  },
  {
    id: 'b_timeline', track: 'business', type: 'single',
    title: 'When would you like to get started?',
    options: [
      { id: 'now', label: 'As soon as possible', tags: ['soon'] },
      { id: 'soon', label: 'In the next month or two' },
      { id: 'exploring', label: "I'm just exploring for now" },
    ],
  },

  // ---------------------------- Individual track ----------------------------
  {
    id: 'i_use', track: 'individual', type: 'single',
    title: 'How often do you use AI today?',
    options: [
      { id: 'never', label: 'Never', points: 0 },
      { id: 'once', label: "I've tried it once or twice", points: 1 },
      { id: 'monthly', label: 'A few times a month', points: 2 },
      { id: 'daily', label: 'Most days', points: 3 },
    ],
  },
  {
    id: 'i_tools', track: 'individual', type: 'multi',
    title: 'Which of these have you tried?',
    help: 'Pick all that apply.',
    options: [
      { id: 'chatgpt', label: 'ChatGPT', points: 1 },
      { id: 'claude', label: 'Claude', points: 1 },
      { id: 'gemini', label: 'Google Gemini', points: 1 },
      { id: 'copilot', label: 'Microsoft Copilot', points: 1 },
      { id: 'phone', label: 'The assistant on my phone', points: 1 },
      { id: 'none', label: 'None yet', points: 0, exclusive: true },
    ],
  },
  {
    id: 'i_goals', track: 'individual', type: 'multi', max: 3,
    title: 'What do you want AI to help with?',
    help: 'Pick up to three.',
    options: [
      { id: 'work', label: 'Doing my job faster or better', tags: ['g_work'] },
      { id: 'personal', label: 'Everyday life: planning, travel, cooking, writing', tags: ['g_personal'] },
      { id: 'career', label: 'A career change or new skills', tags: ['g_career'] },
      { id: 'side', label: 'A side project or small business', tags: ['g_side'] },
      { id: 'understand', label: 'I just want to understand it', tags: ['g_understand'] },
    ],
  },
  {
    id: 'i_first', track: 'individual', type: 'single',
    title: 'What would you like help with first?',
    options: [
      { id: 'writing', label: 'Writing emails and documents', tags: ['f_writing'] },
      { id: 'research', label: 'Getting answers I can trust', tags: ['f_research'] },
      { id: 'organize', label: 'Organizing my plans and my week', tags: ['f_organize'] },
      { id: 'learning', label: 'Learning something new', tags: ['f_learning'] },
      { id: 'creative', label: 'Creative projects', tags: ['f_creative'] },
    ],
  },
  {
    id: 'i_worry', track: 'individual', type: 'single',
    title: 'What holds you back the most?',
    options: [
      { id: 'start', label: "I don't know where to start", tags: ['c_start'] },
      { id: 'trust', label: "I'm not sure I can trust the answers", tags: ['c_trust'] },
      { id: 'privacy', label: "I worry about my privacy", tags: ['c_privacy'] },
      { id: 'technical', label: 'It feels too technical', tags: ['c_technical'] },
      { id: 'nothing', label: "Nothing, I'm excited", points: 1 },
    ],
  },
  {
    id: 'i_comfort', track: 'individual', type: 'single',
    title: 'How comfortable are you with new technology?',
    options: [
      { id: 'low', label: 'I usually ask someone for help', points: 0 },
      { id: 'ok', label: 'I get there with a little guidance', points: 1 },
      { id: 'good', label: 'I pick things up quickly', points: 2 },
      { id: 'high', label: "I'm the one people ask", points: 3 },
    ],
  },
  {
    id: 'i_time', track: 'individual', type: 'single',
    title: 'How much time can you give to learning each week?',
    options: [
      { id: 'little', label: 'Less than 30 minutes' },
      { id: 'hour', label: 'About an hour' },
      { id: 'more', label: 'A few hours', tags: ['time_lots'] },
    ],
  },
  {
    id: 'i_style', track: 'individual', type: 'single',
    title: 'How do you like to learn?',
    options: [
      { id: 'private', label: 'One-on-one, in person' },
      { id: 'group', label: 'In a small group' },
      { id: 'self', label: 'On my own, with a guide to follow' },
    ],
  },

  // ------------------------------ Everyone ----------------------------------
  {
    id: 'location', track: 'both', type: 'single',
    title: 'Where are you based?',
    help: 'Sessions are in person, so this helps me plan.',
    options: [
      { id: 'boca', label: 'Boca Raton' },
      { id: 'delray', label: 'Delray Beach' },
      { id: 'pbc', label: 'West Palm Beach or elsewhere in Palm Beach County' },
      { id: 'south_florida', label: 'Elsewhere in South Florida', tags: ['remote'] },
      { id: 'elsewhere', label: 'Somewhere else', tags: ['remote'] },
    ],
  },
]

// -----------------------------------------------------------------------------
// Levels. The score is turned into a percent of the highest possible score for
// the track. `upTo` is the highest percent that still counts as that level.
// -----------------------------------------------------------------------------
export const LEVELS: { key: LevelKey; upTo: number; name: string; summary: Record<Track, string> }[] = [
  {
    key: 'curious', upTo: 33, name: 'Curious',
    summary: {
      business: 'You are at the starting line, and that is a good place to be: there are no bad habits to undo. A few simple, safe wins will show you and your team what AI can really do.',
      individual: 'You are at the starting line, and that is a good place to be. With a little guidance, AI will feel a lot less mysterious and a lot more useful.',
    },
  },
  {
    key: 'experimenting', upTo: 66, name: 'Experimenting',
    summary: {
      business: 'You have tried AI and seen glimpses of what it can do. The next step is turning scattered experiments into a few dependable habits that save real time every week.',
      individual: 'You have tried AI and seen glimpses of what it can do. The next step is learning to ask for exactly what you need, so the results are good every time.',
    },
  },
  {
    key: 'systemize', upTo: 100, name: 'Ready to systemize',
    summary: {
      business: 'AI is already part of how you work. You are ready to make it consistent across the business: shared prompts, clear rules, and processes that run with less hands-on effort.',
      individual: 'AI is already part of your routine. You are ready for the advanced moves: building your own assistants, connecting tools, and saving your best prompts.',
    },
  },
]

// -----------------------------------------------------------------------------
// Next steps. The list is read top to bottom and the FIRST THREE that match are
// shown, so put the most specific ones first. A step matches when the person has
// ALL the tags in `needs`. Besides the tags on answers above, everyone gets:
//   track:business or track:individual, and level:curious / level:experimenting / level:systemize
// The steps at the bottom of each track need only the track, so there are always three.
// -----------------------------------------------------------------------------
export const RECOMMENDATIONS: { needs: string[]; title: string; body: string }[] = [
  // Business, specific
  {
    needs: ['track:business', 'sensitive'],
    title: 'Set simple privacy rules first',
    body: 'Because you handle private client information, decide what may and may not be typed into an AI tool, and turn on the privacy settings in the tools you use. One page of plain rules is enough to start.',
  },
  {
    needs: ['track:business', 'level:systemize', 'w_automation'],
    title: 'Pick one process to automate from start to finish',
    body: 'Choose a process that repeats every week, such as new client intake or invoice follow-up. Map each step, then let AI handle the routine parts while a person approves the result.',
  },
  {
    needs: ['track:business', 'team', 'w_team'],
    title: 'Train the whole team together',
    body: 'When everyone learns the same basics in the same room, AI stops being one person\'s hobby. A hands-on workshop using your real tasks gets the whole team to a shared starting point.',
  },
  {
    needs: ['track:business', 't_email'],
    title: 'Let AI draft your everyday emails',
    body: 'Save three or four prompts for the emails you write most: replies, follow-ups, polite reminders. You review and send. Most people get 30 minutes a day back from this alone.',
  },
  {
    needs: ['track:business', 't_customers'],
    title: 'Build an answer bank for common questions',
    body: 'Collect your ten most common customer questions and your best answers. AI can then draft a friendly, accurate reply in seconds, in your voice.',
  },
  {
    needs: ['track:business', 't_paperwork'],
    title: 'Hand the paperwork to AI',
    body: 'AI is very good at reading documents, pulling out details and filling in forms. Start with one document you handle every week and have AI do the first pass.',
  },
  {
    needs: ['track:business', 't_writing'],
    title: 'Create templates for proposals and letters',
    body: 'Teach AI your tone with two or three good examples, then have it produce first drafts of proposals, letters and posts. Editing a draft is much faster than starting from a blank page.',
  },
  {
    needs: ['track:business', 't_marketing'],
    title: 'Plan a month of marketing in one sitting',
    body: 'Use AI to turn what you already know about your customers into a month of posts, emails and ideas. You stay the editor, and the blank page goes away.',
  },
  {
    needs: ['track:business', 't_scheduling'],
    title: 'Take the back-and-forth out of scheduling',
    body: 'Combine a booking link with AI-drafted confirmations and reminders. Fewer no-shows, fewer messages, and nothing slips through the cracks.',
  },
  {
    needs: ['track:business', 'paid_ai', 'level:curious'],
    title: 'Use what you already pay for',
    body: 'You already have AI in your tools. A short session to switch on the right features and learn the basics will pay for itself quickly.',
  },
  {
    needs: ['track:business', 'level:systemize'],
    title: 'Build a shared prompt library',
    body: 'Gather the prompts that work into one shared place, organized by task. New staff get good results on day one, and everyone stops reinventing the wheel.',
  },
  // Business, always available
  {
    needs: ['track:business'],
    title: 'Start with one task that repeats every week',
    body: 'Pick a single task that eats time, and learn to do it with AI until it feels natural. One solid win builds more confidence than ten half-tried ideas.',
  },
  {
    needs: ['track:business'],
    title: 'Choose one main AI tool',
    body: 'One well-chosen tool that everyone knows beats five that nobody uses. Pick it based on the software you already work in every day.',
  },
  {
    needs: ['track:business'],
    title: 'Set aside 20 minutes a week to practice',
    body: 'AI skill grows with small, regular use. A short weekly habit on real work keeps the momentum going.',
  },

  // Individual, specific
  {
    needs: ['track:individual', 'c_privacy'],
    title: 'Learn what is safe to share',
    body: 'A few simple habits keep you safe: know which details never to type in, and switch on the privacy settings. Once you know the rules, you can relax and explore.',
  },
  {
    needs: ['track:individual', 'c_trust'],
    title: 'Learn to check AI answers',
    body: 'AI sounds confident even when it is wrong. Learn to ask for sources, ask follow-up questions and spot the answers worth double-checking.',
  },
  {
    needs: ['track:individual', 'c_technical'],
    title: 'Start by simply talking to it',
    body: 'There is nothing to install and no code to learn. If you can write a text message, you can use AI. Begin by asking it a question the way you would ask a helpful friend.',
  },
  {
    needs: ['track:individual', 'g_work'],
    title: 'Bring one real work task',
    body: 'Choose a task from your actual job, such as a report or a tricky email, and learn to do it with AI. Skills stick when you practice on something that matters to you.',
  },
  {
    needs: ['track:individual', 'g_career'],
    title: 'Use AI as a career coach',
    body: 'AI can sharpen your resume, prepare you for interviews and map out which skills to learn next. Bring a job posting you like and work from there.',
  },
  {
    needs: ['track:individual', 'g_side'],
    title: 'Put AI to work on your project',
    body: 'From naming and planning to writing your website, AI can act as the extra pair of hands a side project never has.',
  },
  {
    needs: ['track:individual', 'f_organize'],
    title: 'Make AI your planning partner',
    body: 'Hand AI your messy list and ask for a plan: a weekly schedule, a trip itinerary, a meal plan. It is the fastest way to feel the benefit in daily life.',
  },
  {
    needs: ['track:individual', 'level:systemize'],
    title: 'Build your own custom assistant',
    body: 'Set up an assistant that already knows your preferences, your writing style and your goals, so you never start from zero again.',
  },
  // Individual, always available
  {
    needs: ['track:individual'],
    title: 'Pick one AI tool and stay with it',
    body: 'They are more alike than different. Choose one, use it for a few weeks and get comfortable before you look at the others.',
  },
  {
    needs: ['track:individual'],
    title: 'Learn the three-part prompt',
    body: 'Tell AI who it should be, what you want and what a good answer looks like. This one habit improves almost every result.',
  },
  {
    needs: ['track:individual'],
    title: 'Use it for ten minutes a day',
    body: 'Ask AI one real question every day. Small, regular practice builds skill faster than an occasional long session.',
  },
]

// -----------------------------------------------------------------------------
// Which offer to suggest. Read top to bottom, FIRST match wins.
// -----------------------------------------------------------------------------
export const OFFER_RULES: { needs: string[]; offer: OfferKey }[] = [
  { needs: ['track:business', 'level:systemize', 'w_automation'], offer: 'advanced_automation' },
  { needs: ['track:business', 'team'], offer: 'team_workshop' },
  { needs: ['track:business', 'w_team'], offer: 'team_workshop' },
  { needs: ['level:curious'], offer: 'free_call' },
  { needs: [], offer: 'ai_training_session' },
]

export const CONTACT_EMAIL = 'mashablair@gmail.com'
const mailto = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`

export const OFFERS: Record<OfferKey, { name: string; price: string; body: string; cta: string; url: string }> = {
  free_call: {
    name: 'Free 20-minute call', price: 'Free',
    body: 'A short, no-pressure call to talk through your results and whether training is a good fit.',
    cta: 'Ask for a free call', url: mailto('Free 20-minute call'),
  },
  ai_training_session: {
    name: 'AI Training Session', price: '$99 per hour',
    body: 'Private, in-person training on your real tasks. Book 1 to 10 hours. You leave each session with something working.',
    cta: 'Book a session', url: 'https://buy.stripe.com/7sY3cn5jKflV2NN8fm6sw04',
  },
  team_workshop: {
    name: 'Team workshop', price: 'Quoted for your team',
    body: 'A hands-on workshop at your office. Your whole team learns the same safe, practical basics using your own work.',
    cta: 'Ask about a workshop', url: mailto('Team AI workshop'),
  },
  advanced_automation: {
    name: 'Advanced automation', price: 'Quoted for your project',
    body: 'We map one of your processes and build an AI workflow that runs it, with a person in control of the final step.',
    cta: 'Ask about automation', url: mailto('AI automation project'),
  },
}

/** Shown as an extra note when the person is outside Palm Beach County. */
export const REMOTE_NOTE =
  'I work in person in Boca Raton, Delray Beach and Palm Beach County. You are a little outside that area, so reply to this email and we can see what is possible.'

// -----------------------------------------------------------------------------
// Words on the assessment screens and in the results email.
// -----------------------------------------------------------------------------
export const COPY = {
  intro: {
    label: 'Free AI assessment',
    title: 'Find out where AI can help you most',
    body: 'Answer a few quick questions. It takes about 3 minutes. You get your AI level, three next steps made for you, and a suggestion for where to begin.',
    start: 'Start',
  },
  contact: {
    title: 'Where should I send your results?',
    body: 'Your results arrive by email in a minute or two.',
    firstName: 'First name',
    lastName: 'Last name (optional)',
    email: 'Email',
    company: 'Business name (optional)',
    consent: 'I will email your results and may follow up personally. No newsletters, no sharing your details.',
    submit: 'Send my results',
  },
  thanks: {
    title: 'Your results are on the way',
    body: 'Check your inbox for an email from Maria Blair. If it is not there in a few minutes, look in your spam folder.',
    accountTitle: 'Want to see them right now?',
    accountBody: 'Create your free account to view your results in the browser. I will email you a sign-in link and a code. No password needed.',
    accountButton: 'Email me a sign-in link',
  },
  results: {
    levelLabel: 'Your AI level',
    stepsTitle: 'Your three next steps',
    offerLabel: 'A good place to begin',
  },
  email: {
    subject: (levelName: string) => `Your AI assessment results: ${levelName}`,
    greeting: (firstName: string) => `Hi ${firstName},`,
    intro: 'Thank you for taking the AI assessment. Here is what your answers tell me.',
    signoff: 'If you have any questions, just reply to this email. It comes straight to me.',
    signature: 'Maria Blair\nAI Consulting · Boca Raton, Delray Beach and Palm Beach County',
    viewOnline: 'See your results online',
  },
}
