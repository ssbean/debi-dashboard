# Debi Dashboard

CEO Email Assistant — an internal tool that polls the CEO's Gmail inbox, classifies incoming emails against configurable triggers, drafts AI-generated replies in the CEO's voice, and lets the EA review/edit/approve them before sending.

## Linear

- **Project**: Debi's Dashboard
- **Project ID**: 96ff9446-6bd6-4dc5-bb5c-1322d677f167
- **Project URL**: https://linear.app/wksusa/project/debis-dashboard-62fd6f1086f9
- **Team**: AI Labs

## Stack

- **Framework**: Next.js 16 (App Router) + TypeScript + React 19
- **Auth**: Auth.js v5 (Google OAuth, email allowlist)
- **Database**: Supabase (PostgreSQL) — migrations in `supabase/migrations/`
- **AI**: Anthropic Claude — Haiku for classification, Sonnet for draft generation
- **Email**: Gmail API via Google service account impersonation
- **UI**: shadcn/ui (new-york style) + Tailwind CSS v4 + Lucide icons
- **Scheduling**: Luxon for timezone-aware business-hours logic
- **Deployment**: Vercel (prebuild locally per workspace rules)

## Commands

```bash
npm run dev          # Local dev server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
```

**Deploy:**
```bash
vercel build && vercel deploy --prebuilt                    # Preview
vercel build --prod && vercel deploy --prod --prebuilt      # Production
```

## Architecture

### Pipeline (3 Vercel cron jobs, hourly)

1. **Poll & Classify** (`:00`) — `src/app/api/cron/poll-classify/route.ts`
   Polls CEO Gmail for unread emails → classifies via LLM or Gmail filter → creates `needs_drafting` drafts

2. **Generate Drafts** (`:05`) — `src/app/api/cron/generate-drafts/route.ts`
   Picks up `needs_drafting` drafts → Claude Sonnet generates reply using trigger style examples → schedules send within reply window

3. **Send Emails** (`:10`) — `src/app/api/cron/send-emails/route.ts`
   Sends approved drafts whose scheduled time has passed → Gmail API impersonation → retry up to 3 attempts

### Draft status flow

```
needs_drafting → pending_review → approved → sent
                                → rejected
               → auto_approved  → sent
                                → failed (after 3 retries)
```

### Key directories

```
src/
├── app/
│   ├── (protected)/          # Auth-gated pages (dashboard, admin, settings)
│   ├── api/cron/             # 3 pipeline cron routes
│   ├── api/drafts/           # Approve/reject/regenerate/send-now
│   ├── api/triggers/         # Trigger CRUD + Gmail filter test
│   └── api/settings/         # App settings
├── lib/
│   ├── claude.ts             # classifyEmail() + draftEmail()
│   ├── gmail.ts              # Gmail fetch/send/filter/signature
│   ├── scheduler.ts          # Business-hours send time calculation
│   ├── cron-auth.ts          # CRON_SECRET verification
│   ├── cron-logger.ts        # Cron run logging
│   ├── types.ts              # TypeScript interfaces
│   └── supabase/             # Client + server Supabase clients
└── components/ui/            # shadcn/ui components
```

## Conventions

- **Server Components** for data-fetching pages; **Client Components** (`"use client"`) for interactive forms
- **API routes**: auth via `await auth()` (pages) or `CRON_SECRET` bearer token (cron)
- **Database**: snake_case columns, UUIDs, `timestamptz`, soft delete via `deleted_at`
- **Files**: kebab-case (`draft-editor.tsx`), interfaces PascalCase (`Draft`, `Trigger`)
- **Errors**: typed classes in `src/lib/errors.ts` (`GmailError`, `ClaudeError`, `SchedulingError`, `AuthError`)
- **Supabase**: service role client for all server-side DB operations (bypasses RLS)
- **Claude prompts**: use `cache_control: { type: "ephemeral" }` on system content for prompt caching
- **Dates/times**: always display in CEO timezone (from settings), not browser timezone — use `formatDate`/`formatTime` from `src/lib/format-date.ts`
- **Zod** for request body validation on mutation endpoints
- **Toast** via Sonner for user feedback

## Environment Variables

See `.env.example` for the full list. Key ones:
- `ANTHROPIC_API_KEY` — Claude API
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — Gmail impersonation
- `CEO_EMAIL` — Fallback CEO email (also stored in settings DB)
- `CRON_SECRET` — Authenticates Vercel cron requests
- `DEV_MODE` — Set `"true"` to redirect/block outgoing email sends
- `ALLOWED_EMAILS` — Comma-separated Google accounts that can log in
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase

## Database

Supabase PostgreSQL. Migrations in `supabase/migrations/` (applied manually).

**Core tables**: `triggers`, `style_examples`, `drafts`, `settings` (singleton, id=1), `processed_emails`, `cron_logs`

## Notes

- No test suite yet — no `tests/` directory
- Gmail API requires Google Workspace domain-wide delegation (not free Gmail)
- Settings table enforces singleton with a CHECK constraint
- Cron jobs staggered 5 minutes apart to avoid race conditions
- `DEV_MODE` banner renders at top of all protected pages when active
