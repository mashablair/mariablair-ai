# mariablairai.com platform: build plan

Written 2026-11-16 as the handoff spec for the build session. Read this first, then build slice by slice.
Each slice must leave `main` deployable.

## Goal

Turn the one-page marketing site into one connected platform for Maria Blair, AI Consulting:
public site -> assessment -> CRM -> paid sessions -> client resources and (later) courses.
Shared records, minimal manual admin.

## Decisions already made (do not re-ask)

- Same repo (`mariablair-ai`), same domain. The current `index.html` + `images/` marketing page must
  ship byte-for-byte unchanged at `/` (only allowed edit: adding a link/button to `/assessment`).
- Stack: React + TypeScript (Vite), Cloudflare for hosting + API, Supabase (Postgres, Auth, Storage).
- Supabase: a NEW project inside Maria's existing Supabase account.
- Admin login: emailed magic link, restricted to Maria's address (admin role checked in RLS, not just UI).
- Assessment: ONE flow that branches on the first question ("I run a business" / "I'm learning for myself").
- Assessment results: email is required. Results are emailed, and the thank-you screen also offers
  "create your account now to see results in the browser" (email one-time code or magic link).
- Workflow stays: local dev -> private GitHub -> Cloudflare deploys from GitHub on push to `main`.
- The older `ai-for-bookkeepers` repo has a similar assessment. It is optional reference, not a constraint.

## Architecture

- Keep the existing Cloudflare Pages project (custom domain already attached). Add a build step:
  build command `npm run build`, output dir `dist`.
- Build output:
  - `dist/index.html`, `dist/images/*`: the marketing page copied verbatim (do NOT run it through Vite).
  - `dist/app/*`: the React SPA (Vite `base: '/app/'`).
  - `_redirects`: `/assessment/*`, `/admin/*`, `/portal/*`, `/login`, `/demo/*` -> `/app/index.html` (200).
- API: Pages Functions at `/api/*`, written with Hono so it can move to a standalone Worker later.
  The API is thin. It exists only for things the browser must not do:
  - `POST /api/assessment`: validate (zod), Turnstile check, upsert contact, store submission, send results email.
  - `POST /api/stripe/webhook`: verify signature, store raw event (idempotent), match payment.
  - Anything needing the Supabase service-role key. That key lives only in Cloudflare secrets.
- Everything else (admin CRUD, portal reads, file upload/download) goes browser -> Supabase directly,
  protected by Row Level Security. Signed URLs for private files.
- Email: Resend (API from the Function for results emails; also set as Supabase custom SMTP so
  magic links are not rate-limited).
- Frontend: React Router, TanStack Query, Tailwind. Match the marketing page's "Coastal & Upscale"
  look (pull colors/fonts from the CSS variables in `index.html`). Admin is desktop-first but must be
  usable on a phone (Maria adds contacts at networking events).
- Data access goes through one typed repository layer with two implementations: Supabase and an
  in-memory demo store with fictional seed data. `/demo` (or a `VITE_DEMO=1` build) uses the demo store
  with simulated payments. This is the future portfolio version: no real data, no real keys.

## Security rules (non-negotiable)

- RLS enabled on every table. Default deny. Helper `is_admin()` (checks an `admins` table by auth uid).
- Clients can only read rows tied to their own contact, and only tables/columns meant to be shared.
- Internal notes live in their own table (`internal_notes`) with admin-only policies. Never a column
  on a client-readable table.
- A client account links to its CRM contact by verified email on first sign-in (trigger or RPC),
  never by an id the browser supplies.
- Storage buckets private. Client access to a file only through a grant row.
- No secrets in the repo. `.dev.vars` and `.env*` in `.gitignore`. Commit `.env.example`.
- Write SQL tests (or a script) that prove a client user cannot read another client's rows or any note.

## Data model (create all of it in slice 0, even where UI comes later)

- `admins`, `profiles` (auth user <-> contact)
- `companies`, `contacts` (business type, AI needs, relationship stage, source, next action, follow-up date)
- `events` (networking events), `contact_events`
- `internal_notes` (contact/company/session scoped), `tasks` (next actions, due dates, done)
- `assessment_versions` (question set as JSON, versioned), `assessment_submissions` (answers, track,
  score, level, generated recommendations, contact_id)
- `intake_templates`, `intake_responses`
- `sessions` (type: consultation | private | workshop; status; scheduled_at; duration_minutes;
  agreed_rate; plan; outcomes; client_visible_summary)
- `recommendations` (editable, per contact, seeded from assessment, optionally shared)
- `materials` (title, kind, storage_path, tags), `session_materials`, `material_grants` (contact access)
- `offers` (maps to Stripe price / payment link; kind: session | workshop | digital | course)
- `charges` (what is owed: session or offer, amount, invoice_ref), `payments` (amount, method,
  stripe ids, match_status: matched | needs_review | unmatched, contact_id nullable)
- `entitlements` (contact <-> offer, source: purchase | grant)
- `stripe_events` (raw payload, unique event id)
- View: balance per contact (charges minus payments).

Migrations in `supabase/migrations/`. Seed script for demo data (fictional people and companies only).

## Assessment design

- 10 to 12 questions, about 3 minutes, one question per screen, progress bar, works well on a phone.
- Q1 branches: business owner / individual. Business track covers: industry, team size, where time
  goes, current AI use, tools already paid for, data sensitivity, biggest hoped-for win, comfort level.
  Individual track covers: current use, goals (work, personal, career), comfort, time available.
- Output: a level (for example Curious / Experimenting / Ready to systemize), 3 tailored next steps,
  and the matching offer (free 20-minute call, $99/hr AI Training Session, team workshop,
  advanced automation when the answers warrant it).
- Scoring and recommendation rules are plain TypeScript data, shared by the SPA and the API,
  editable without touching UI code. Maria edits wording herself, so keep all copy in one file.
- On submit: contact created or updated (match on lowercased email), submission stored, stage set to
  "assessment completed", follow-up task created for Maria, results emailed.

## Existing business facts

- Offer today: AI Training Session, $99 per hour, 1 to 10 hours, via the Stripe payment link already
  in `index.html`. Free 20-minute call requested by email. Phone number is shared only after purchase.
- Service area: Boca Raton, Delray Beach, West Palm Beach / Palm Beach County.
- Audience: local business owners and regular people learning AI. Plain language, no jargon.

## Build order (vertical slices)

0. Scaffold: Vite app, Pages Functions, build that preserves the marketing page, full schema + RLS,
   magic-link login, admin shell, demo-store switch, `.env.example`, README update.
1. CRM: contacts, companies, events, stages, notes, tasks, "follow-ups due" dashboard, search, CSV import.
2. Assessment: public flow, API endpoint, results email, results page, account creation, CRM linkage.
3. Intake + session planning: templates, responses, session records with plan/outcomes, editable
   recommendations, assessment history on the contact page.
4. Materials library: upload (PPTX, PDF, anything), tags, attach to sessions, grant to contacts.
5. Time and billing: duration x rate -> charges, manual payments, invoice refs, balances.
6. Stripe webhook: auto-match clear payments (email, then payment link/offer), review queue for the rest,
   entitlement on match.
7. Client portal (read-only): my assessment results, shared materials, my products.
Later: courses, follow-up automations, bank feed, public portfolio demo deployment.

After each slice: typecheck, tests, build, commit. Do not push without Maria saying so.

## What only Maria can do (ask her when the slice needs it, give exact click-by-click steps)

1. Create the Supabase project; provide project URL, anon key, service-role key (into `.dev.vars` and
   Cloudflare secrets, never into chat or git if avoidable).
2. Supabase Auth: set Site URL and redirect URLs (localhost + mariablairai.com).
3. Resend: create account, verify mariablairai.com (DNS records in Cloudflare), API key.
4. Cloudflare Pages: set build command/output dir, add environment variables and secrets, Turnstile site.
5. Stripe: add webhook endpoint `https://mariablairai.com/api/stripe/webhook`, provide signing secret.
