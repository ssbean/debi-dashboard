---
title: "feat: Debi UX Improvements — Google Chat Notification + Dashboard Cleanup"
type: feat
status: active
date: 2026-03-07
brainstorm: docs/brainstorms/2026-03-07-debi-ux-improvements-brainstorm.md
---

# feat: Debi UX Improvements — Google Chat Notification + Dashboard Cleanup

## Overview

Two focused improvements to make the dashboard genuinely usable by Debi (non-technical EA):

1. **Google Chat notification** — Notify Debi via Google Chat when new drafts are ready for her review, so she doesn't have to check the dashboard proactively.
2. **Dashboard cleanup** — Remove developer-facing elements (stats, confidence scores, raw status labels, admin nav links) so the dashboard shows only what Debi needs to act on.

## Motivation

The pipeline is working, but Debi won't discover drafts unless she proactively checks the URL. Without a notification, the system is invisible to her. The dashboard also currently surfaces internal metrics (emails scanned, confidence scores, status codes) that don't mean anything to an EA — they create noise and confusion.

---

## Part 1: Google Chat Notification

### How Google Chat incoming webhooks work

A webhook URL is configured once in a Google Chat Space (Settings → Apps & Integrations → Webhooks). Sending a notification is a plain `POST` with a JSON body — no OAuth, no bot setup required.

```
POST https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...
Content-Type: application/json

{ "text": "3 drafts are ready for your review: https://debi-dashboard.vercel.app/dashboard" }
```

### Implementation

#### 1. Database migration — add webhook URL to settings

```sql
-- supabase/migrations/008_add_google_chat_webhook.sql
ALTER TABLE settings ADD COLUMN google_chat_webhook_url text;
```

#### 2. Update `Settings` type

```ts
// src/lib/types.ts
export interface Settings {
  // ... existing fields
  google_chat_webhook_url: string | null;
}
```

#### 3. New utility: `src/lib/google-chat.ts`

```ts
export async function notifyGoogleChat(webhookUrl: string, message: string): Promise<void>
```

- POSTs `{ text: message }` to the webhook URL
- Logs success/failure but never throws — notification failure should not break the cron
- Uses `fetch` (available in Next.js server environment)

#### 4. Trigger notification in `generate-drafts` cron

After the generation loop completes, if `pendingReview > 0` and `settings.google_chat_webhook_url` is set:

```ts
// src/app/api/cron/generate-drafts/route.ts
if (pendingReview > 0 && settings.google_chat_webhook_url) {
  const plural = pendingReview === 1 ? "draft" : "drafts";
  const url = `${process.env.NEXTAUTH_URL ?? "https://debi-dashboard.vercel.app"}/dashboard`;
  await notifyGoogleChat(
    settings.google_chat_webhook_url,
    `${pendingReview} new ${plural} ready for your review: ${url}`
  );
}
```

Note: Only notify for `pending_review` — `auto_approved` drafts don't need her attention.

#### 5. Add webhook URL field to Settings UI

Add a new card in `src/app/(protected)/settings/settings-form.tsx`:

```tsx
<Card>
  <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
  <CardContent>
    <Label>Google Chat Webhook URL</Label>
    <Input
      value={settings.google_chat_webhook_url ?? ""}
      onChange={(e) => setSettings(s => ({ ...s, google_chat_webhook_url: e.target.value || null }))}
      placeholder="https://chat.googleapis.com/v1/spaces/..."
    />
    <p className="text-xs text-muted-foreground">
      Paste your Google Chat incoming webhook URL. A message will be sent when new drafts are ready for review.
    </p>
  </CardContent>
</Card>
```

#### 6. Update settings API route

Ensure `google_chat_webhook_url` is included in the PUT handler at `src/app/api/settings/route.ts`.

---

## Part 2: Dashboard Cleanup

### 2a. Remove stats cards from main dashboard

`src/app/(protected)/dashboard/page.tsx`:

- Remove the 5-card stats grid entirely (Emails Scanned, Matched, Pending Review, Auto-Approved, Sent)
- Remove the 3 DB queries that power those stats (`totalScanned`, `totalMatched`, counts)
- Replace the page header with something action-oriented: **"Pending Review"** if there are drafts waiting, or a friendly empty state if not

### 2b. Simplify status labels and remove confidence scores

In the draft list cards:

| Before | After |
|--------|-------|
| `pending_review` | **Needs Review** |
| `needs_drafting` | *Processing…* |
| `approved` / `auto_approved` | Approved |
| `sent` | Sent |
| `rejected` | Rejected |
| `failed` | Failed |

- Remove `{draft.confidence_score}%` from list items entirely
- Simplify the "To/From trigger" line — show just **To: [name/email]** for pending items, strip "From trigger:" language

### 2c. Remove admin links from nav

`src/app/(protected)/layout.tsx`:

Remove **Triggers** and **Logs** from `navItems`. These are developer-facing pages — Debi shouldn't need them. Admin pages remain accessible directly at `/admin/triggers` and `/admin/cron-logs`.

```ts
const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/history", label: "History" },
  { href: "/settings", label: "Settings" },
];
```

---

## Acceptance Criteria

- [ ] A Google Chat notification is sent when `generate-drafts` produces ≥1 `pending_review` draft
- [ ] Notification message includes count and a direct link to `/dashboard`
- [ ] No notification sent when only `auto_approved` drafts are created
- [ ] Notification failure (bad URL, network error) is logged but does not fail the cron
- [ ] Webhook URL is configurable in the Settings page and saved to the DB
- [ ] Dashboard no longer shows stats cards (Emails Scanned, Matched, etc.)
- [ ] Status labels are human-readable ("Needs Review" not "pending_review")
- [ ] Confidence scores are no longer shown in the draft list
- [ ] Nav shows only: Dashboard, History, Settings (Triggers and Logs removed)
- [ ] Admin pages (`/admin/triggers`, `/admin/cron-logs`) still work when accessed directly

---

## Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/008_add_google_chat_webhook.sql` | New — add column |
| `src/lib/types.ts` | Add `google_chat_webhook_url` to Settings |
| `src/lib/google-chat.ts` | New — webhook POST utility |
| `src/app/api/cron/generate-drafts/route.ts` | Call notification after generation |
| `src/app/api/settings/route.ts` | Include new field in PUT handler |
| `src/app/(protected)/settings/settings-form.tsx` | Add Notifications card |
| `src/app/(protected)/dashboard/page.tsx` | Remove stats, simplify labels |
| `src/app/(protected)/layout.tsx` | Remove Triggers + Logs from nav |

---

## Dependencies & Risks

- **Webhook URL setup:** Requires Debi (or Spencer) to create an incoming webhook in Google Chat. Steps: open a Chat Space → click space name → Apps & Integrations → Webhooks → Add webhook. Copy the URL into Settings.
- **`NEXTAUTH_URL` env var:** Used to construct the dashboard link in the notification. Should already be set in production. Add a fallback to the hardcoded Vercel URL.
- **No test suite:** Manual verification only. Test by triggering the generate-drafts cron after setting a webhook URL.
