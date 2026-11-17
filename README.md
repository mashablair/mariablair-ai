# mariablairai.com

Website and client platform for **Maria Blair, AI Consulting**: in-person AI training and setup for businesses in Boca Raton, Delray Beach and Palm Beach County.

The build plan and the decisions behind it are in [docs/PLATFORM_PLAN.md](docs/PLATFORM_PLAN.md).

## What is in here

| Path | What it is |
| --- | --- |
| `index.html`, `images/` | The marketing page. Shipped **byte-for-byte as-is** at `/`. It never goes through the build tools. |
| `app/` | The React app (Vite + TypeScript + Tailwind): assessment, admin, client portal, login. Served under `/app/`. |
| `server/`, `functions/api/` | The small API (Hono on Cloudflare Pages Functions) at `/api/*`. Only for things the browser must not do. |
| `shared/` | Types and rules used by both the app and the API. |
| `supabase/migrations/` | The whole database: tables, Row Level Security, storage rules. |
| `tests/` | Tests, including proof that one client cannot read another client's data or any internal note. |
| `scripts/` | Build helpers: `assemble.mjs` copies the marketing page into `dist/`, `_redirects` routes app URLs. |

Site URLs: `/` marketing page, `/assessment`, `/login`, `/admin`, `/portal`, `/demo` (sample data, no keys), `/api/*`.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173/demo/admin for the demo with sample data (works with no setup).
For real data, copy `.env.example` to `.env.local` and `.dev.vars`, fill them in, then use http://localhost:5173/login.
For the API locally, run `npm run preview` (builds, then serves everything the way Cloudflare does on http://localhost:8788).

## Checks

```bash
npm run typecheck
npm test
npm run build
```

`npm run build` fails if the marketing page in `dist/` is not identical to `index.html`.

## Deploy

Pushing to `main` deploys through Cloudflare Pages. Pages settings: build command `npm run build`, output directory `dist`.
Database changes: add a file to `supabase/migrations/`, then `npm run db:push`.

## Security rules

- Every table has Row Level Security, default deny. Admin access is checked in the database (`is_admin()`), not just hidden in the UI.
- Clients can read only rows tied to their own contact. Internal notes live in their own admin-only table.
- A client account is linked to its contact by the email Supabase verified, never by an id from the browser.
- No secrets in git. `.dev.vars` and `.env*` are ignored. The Supabase service-role key lives only in Cloudflare secrets.

## Booking and payment

- Free 20-minute call: the pop-up is a short form. Each request becomes a contact (or updates an existing one), with the message as a private note, a follow-up task due today, a confirmation email to the visitor and a notification to Maria. Email stays available as a fallback. The email wording is in `shared/callRequest.ts`.
- Paid session: the "Book a session" buttons open the Stripe payment link (AI Training Session, $99 per hour, 1 to 10 hours). After paying, Stripe shows the phone number to text or call to schedule.

## Later

- `TESTIMONIAL`: uncomment the section in `index.html` after your first client
