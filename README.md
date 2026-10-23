# mariablairai.com

One-page website for **Maria Blair, AI Consulting**: in-person AI training and setup for businesses in Boca Raton, Delray Beach and Palm Beach County.

## Structure

- `index.html`: the whole site (HTML, CSS and structured data in one file)
- `images/`: headshot, client meeting and laptop photos

No build step. Cloudflare Pages serves the repo root as-is.

## Deploy

Pushing to `main` deploys automatically through Cloudflare Pages.

## Booking and payment

- Free 20-minute call: the pop-up asks visitors to email mashablair@gmail.com.
- Paid session: the "Book a session" buttons open the Stripe payment link (AI Training Session, $99 per hour, 1 to 10 hours). After paying, Stripe shows the phone number to text or call to schedule.

## Later

- `TESTIMONIAL`: uncomment the section in `index.html` after your first client
