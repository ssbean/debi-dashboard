---
title: "feat: BCC all recipients instead of reply-all"
type: feat
status: completed
date: 2026-03-13
---

# BCC All Recipients Instead of Reply-All

## Overview

Change the email sending pipeline so all recipients are placed in BCC rather than visible To/CC headers. The CEO's own email goes in the `To:` field (self-send) to maintain valid MIME. This prevents recipients from seeing who else received the email.

## Motivation

When the CEO sends congratulatory or informational emails to multiple people, reply-all exposes the full recipient list. BCC keeps each recipient's copy private.

## Proposed Solution

Apply BCC universally to all sends (both reply-in-thread and standalone). Keep the implementation simple — one behavior for all trigger types.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `To:` header value | CEO's own email (self-send) | Valid MIME, keeps copy in Sent folder |
| Scope | All sends (not just reply-all) | Simpler code, consistent behavior |
| Audit trail | New `sent_bcc` column | Preserves historical `sent_to`/`sent_cc` data |
| DEV_MODE redirect | Put redirect address in `To:` directly | Dev can see the email clearly; show original BCC in banner |
| Thread continuity | Accept potential breakage in recipients' inboxes | `In-Reply-To`/`References` + `threadId` still work for sender's mailbox. Recipients may see it as a new message — acceptable tradeoff |

## Implementation

### Phase 1: Database migration

- [x] Add `sent_bcc text` column to `drafts` table

**File:** `supabase/migrations/012_sent_bcc.sql`

```sql
ALTER TABLE drafts ADD COLUMN sent_bcc text;
```

### Phase 2: Gmail send with BCC

- [x] Add `bcc` field to `SendEmailOptions` interface in `src/lib/gmail.ts`
- [x] Add `Bcc:` header to MIME construction in `sendEmail()`
- [x] Set `To:` to CEO's own email when BCC is provided
- [x] Update DEV_MODE redirect logic: when BCC is present, put redirect in `To:`, show original BCC list in redirect banner

**File:** `src/lib/gmail.ts`

```typescript
// SendEmailOptions — add bcc
export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  cc?: string | null;
  bcc?: string | null;       // NEW
  redirectTo?: string | null;
  signature?: string | null;
}

// In sendEmail(), add Bcc header:
const headers = [
  `From: ${sanitizeHeaderValue(ceoName)} <${sanitizeHeaderValue(ceoEmail)}>`,
  `To: ${sanitizeHeaderValue(actualTo)}`,
  ...(actualCc ? [`Cc: ${sanitizeHeaderValue(actualCc)}`] : []),
  ...(bcc ? [`Bcc: ${sanitizeHeaderValue(bcc)}`] : []),  // NEW
  `Subject: =?UTF-8?B?${Buffer.from(replySubject).toString("base64")}?=`,
  `Content-Type: text/html; charset=utf-8`,
];
```

### Phase 3: Recipient resolution → BCC

- [x] Rename `resolveReplyAllRecipients()` → `resolveRecipients()` in `src/lib/send-draft.ts`
- [x] Return a flat deduplicated list instead of `{ to, cc }`
- [x] In `sendDraft()`, pass all recipients as `bcc` and set `to` to CEO email
- [x] Persist `sent_to` (CEO self), `sent_cc` (null), `sent_bcc` (all recipients)

**File:** `src/lib/send-draft.ts`

```typescript
// Before: returns { to: string[], cc: string[] }
// After:  returns string[] (flat, deduplicated, self excluded)
function resolveRecipients(
  latestFrom: string,
  latestTo: string,
  latestCc: string | null,
  latestReplyTo: string | null,
  ceoEmail: string,
): string[] {
  // Combine Reply-To/From + To + CC, exclude self, deduplicate
}

// In sendDraft():
const allRecipients = resolveRecipients(...);
await sendEmail({
  to: ceoEmail,           // self-send
  bcc: allRecipients.join(", "),
  // ...
});

// Audit:
await supabase.from("drafts").update({
  sent_to: ceoEmail,
  sent_cc: null,
  sent_bcc: allRecipients.join(", "),
}).eq("id", draft.id);
```

### Phase 4: Types & UI

- [x] Add `sent_bcc: string | null` to `Draft` interface in `src/lib/types.ts`
- [x] Update `draft-editor.tsx` post-send display to show "BCC:" with `draft.sent_bcc`
- [x] Update pre-send preview: change "Reply-all to thread" to "BCC to thread recipients"
- [x] Add note: "Recipients won't see other recipients"

**File:** `src/app/(protected)/dashboard/[id]/draft-editor.tsx`

## Acceptance Criteria

- [ ] All outgoing emails use BCC for recipients, `To:` is CEO's own email
- [ ] Gmail API delivers to BCC addresses (verify with test send)
- [ ] Thread continuity works in CEO's Sent folder (threaded by `threadId`)
- [ ] `sent_bcc` column populated for audit trail
- [ ] UI shows BCC recipients in draft detail page
- [ ] DEV_MODE redirect still works (redirect address in To:, original BCC in banner)
- [ ] Historical drafts (sent with To/CC) still display correctly

## References

- `src/lib/gmail.ts:304-372` — Current `SendEmailOptions` + `sendEmail()`
- `src/lib/send-draft.ts:25-60` — Current `resolveReplyAllRecipients()`
- `src/lib/send-draft.ts:68-162` — Current `sendDraft()`
- `src/app/(protected)/dashboard/[id]/draft-editor.tsx:296-323` — Recipient display UI
- Previous plan: `docs/plans/2026-03-12-feat-reply-all-latest-thread-message-plan.md`
