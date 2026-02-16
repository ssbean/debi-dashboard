---
title: "feat: DEV Mode — Poll & Classify Without Sending"
type: feat
status: active
date: 2026-02-16
---

# feat: DEV Mode — Poll & Classify Without Sending

## Overview

Add a DEV mode toggle that allows the app to poll for emails, classify them, and generate drafts — but **never send emails**. A persistent, always-visible banner indicates when DEV mode is active. This enables safe testing against the real inbox without risk of sending unintended emails.

## Problem Statement

The app is live and polling the CEO's inbox. Before we're confident in classification quality and draft output, we need a safe way to observe the system without any emails leaving the account. A single env var or settings toggle should gate all sending.

## Proposed Solution

Use an environment variable `DEV_MODE=true` as the primary control. This is checked at two layers:

1. **Send cron** — early-exit without sending any emails
2. **Approve API** — prevent status from moving to `approved` (optional, or just let it queue harmlessly)
3. **UI banner** — persistent yellow/orange banner at the top of every protected page

### Why env var instead of DB setting?

- Can't accidentally be toggled by a UI click
- Matches deployment environments (dev vs prod)
- No migration needed
- Can be flipped in Vercel dashboard without a deploy

## Technical Approach

### 1. Environment Variable

Add `DEV_MODE` to `.env.example`:

```
# Set to "true" to disable email sending (poll + classify still runs)
DEV_MODE=true
```

### 2. Send Cron Guard — `src/app/api/cron/send-emails/route.ts`

Add an early return at the top of the GET handler, after cron auth:

```typescript
if (process.env.DEV_MODE === "true") {
  logger.info("DEV_MODE active — skipping email send", "send-emails");
  return NextResponse.json({ message: "DEV_MODE active, no emails sent" });
}
```

This is the **only** place that actually calls `sendEmail()`, so guarding here is sufficient. Poll-classify and generate-drafts continue running normally.

### 3. Approve API Guard — `src/app/api/drafts/[id]/approve/route.ts`

When DEV_MODE is active, still allow approval (so the EA can test the workflow) but log a warning. The draft moves to `approved` status but the send cron won't act on it. No code change needed here — the send cron guard handles it.

### 4. DEV Mode Banner — `src/app/(protected)/layout.tsx`

Add a banner above the header, visible on every protected page:

```tsx
{process.env.DEV_MODE === "true" && (
  <div className="bg-amber-500 text-amber-950 text-center text-sm font-medium py-1.5">
    DEV MODE — Emails will not be sent
  </div>
)}
```

Since this is a Server Component reading an env var (no `NEXT_PUBLIC_` prefix), it's evaluated at render time on the server. The banner shows on every page load.

### 5. Dashboard Indicator

On the dashboard page, if DEV_MODE is active, show a note next to any `approved` or `auto_approved` drafts indicating they won't send:

```
Status: approved (sending paused — DEV MODE)
```

## Implementation Checklist

- [ ] Add `DEV_MODE=true` to `.env.example` with comment — `.env.example`
- [ ] Add early-return guard in send-emails cron — `src/app/api/cron/send-emails/route.ts`
- [ ] Add DEV MODE banner to protected layout — `src/app/(protected)/layout.tsx`
- [ ] Add "(sending paused)" indicator on dashboard draft cards — `src/app/(protected)/dashboard/page.tsx`
- [ ] Add `DEV_MODE=true` to Vercel env vars
- [ ] Deploy and verify: cron logs show "DEV_MODE active", banner visible, no emails sent

## Acceptance Criteria

- [ ] When `DEV_MODE=true`: poll-classify cron runs normally and creates drafts
- [ ] When `DEV_MODE=true`: generate-drafts cron runs normally and produces drafts
- [ ] When `DEV_MODE=true`: send-emails cron exits early without calling Gmail API
- [ ] When `DEV_MODE=true`: yellow banner visible on every protected page
- [ ] When `DEV_MODE=true`: dashboard shows "sending paused" on approved drafts
- [ ] When `DEV_MODE` is unset or `false`: everything works normally (no banner, emails send)
- [ ] No code path calls `sendEmail()` when DEV_MODE is true

## References

- Send cron: `src/app/api/cron/send-emails/route.ts`
- Protected layout: `src/app/(protected)/layout.tsx`
- Dashboard: `src/app/(protected)/dashboard/page.tsx`
- Gmail send function: `src/lib/gmail.ts:sendEmail()`
