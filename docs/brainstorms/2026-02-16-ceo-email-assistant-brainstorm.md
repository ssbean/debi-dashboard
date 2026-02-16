# CEO Email Assistant — Brainstorm

**Date:** 2026-02-16
**Status:** Draft

## What We're Building

A web app ("Debi Dashboard") that enables the CEO's executive assistant (EA) to review, edit, and approve AI-drafted emails sent on the CEO's behalf. The system monitors the CEO's inbox for trigger events (e.g., exceptional sales reports, promotion announcements, new hire notifications), drafts contextually appropriate emails, and queues them for the EA's review.

Over time, the EA can increase the system's autonomy via a confidence threshold — moving from approving every email to only reviewing low-confidence drafts, and eventually to fully autonomous sending.

### Core User Flow

1. **Polling** picks up new unread emails from internal company domains in the CEO's inbox
2. **Classifier** (Claude) evaluates it against configured trigger descriptions
3. If matched → **Drafter** (Claude) generates an email using CEO's style + examples
4. Draft lands in the EA's **dashboard** with a scheduled send time (4-6 business hours out)
5. EA reviews, optionally edits, and approves (or the system auto-sends if confidence exceeds threshold)
6. Email is sent via Gmail API using the service account impersonating the CEO

### Email Types (Initial)

| Type | Trigger | Recipient |
|---|---|---|
| Congratulatory | Finance alerts exceptional sales performance | The high-performing individual(s) |
| Promotional | HR/management announces a promotion | The promoted employee |
| Welcome | HR announces a new hire | The new staff member |

New types can be added by the EA via an admin UI.

## Why This Approach

### Tech Stack: Next.js + TypeScript + Supabase + Vercel

- **Next.js** handles both the dashboard UI and API routes (polling, webhook, Gmail integration) in one project
- **Supabase (Postgres)** stores triggers, drafts, approved emails, style examples, and learned preferences
- **Vercel** is the natural deployment target for Next.js; Vercel Cron handles the polling schedule
- **Claude (Anthropic)** powers both trigger classification and email drafting

### Polling over Pub/Sub

The 4-6 business hour send window makes real-time detection unnecessary. Polling every 5 minutes is dramatically simpler — no GCP Pub/Sub setup, no webhook infrastructure, no 7-day watch renewal. Can upgrade to Pub/Sub later if needed.

**Pre-filter:** Only unread emails from internal company domains are sent to the classifier. This keeps token costs low and avoids false positives from external senders.

### Style Learning: Examples + Extracted Rules

- Seed with 5-10 real CEO emails per type
- When the EA edits a draft, store the before/after diff. A separate Claude call analyzes the diff and produces free-text style rules (e.g., "prefers first-name greetings," "keeps emails under 4 sentences") stored alongside examples
- Use both the example bank and extracted rules in future prompts
- This creates a feedback loop that improves over time without fine-tuning

### Autonomy: Global Confidence Threshold

- The AI self-scores confidence on each draft (0-100)
- A single threshold slider controls autonomy: drafts scoring above the threshold auto-send; below requires review
- Start with threshold at 100 (everything reviewed), EA lowers it over time
- Simple UX, avoids per-type configuration complexity

## Key Decisions

1. **Polling (not Pub/Sub)** — Simpler, sufficient for hours-delayed sending. Upgrade path exists.
2. **Claude for classification + drafting** — Single AI provider, strong at style matching.
3. **Few-shot examples + extracted style rules** — Both stored in DB, improve over time from EA edits.
4. **Global confidence threshold** — Single slider for autonomy, not per-email-type.
5. **Supabase Postgres** — Structured data, real-time subscriptions for dashboard updates.
6. **Admin UI for triggers** — EA can add/edit trigger descriptions and create new email types.
7. **Google OAuth for auth** — Existing OAuth client, allowed users in env var.
8. **Vercel deployment** — Natural Next.js host, Vercel Cron for polling.
9. **Internal-only pre-filter** — Only classify emails from company domains to control cost and noise.
10. **Recipient extraction by AI** — Classifier pulls recipient from trigger email; EA can correct.

## Resolved Questions

1. **Recipient extraction** — AI extracts the recipient from the trigger email body. EA can correct if wrong.
2. **Send timing** — Randomized within the 4-6 business hour window. Feels more natural/human.
3. **Thread vs. new email** — Depends on type. Configurable per email type (e.g., congrats may reply in thread; welcome emails are standalone).
4. **Email tracking** — Send confirmation only. No open/read tracking.

5. **CEO visibility** — EA-only tool. Sent emails appear in CEO's Sent folder via impersonation, but no dashboard access needed.
