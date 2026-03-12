---
title: "feat: Reply-all to latest thread message"
type: feat
status: completed
date: 2026-03-12
---

# Reply-All to Latest Thread Message

## Enhancement Summary

**Deepened on:** 2026-03-12
**Research agents used:** TypeScript reviewer, Architecture strategist, Security sentinel, Performance oracle, Code simplicity reviewer, Pattern recognition specialist, Data migration expert, Data integrity guardian, Best practices researcher
**Phases:** Restructured from 7 → 4 focused phases + 2 prerequisite fixes

### Key Improvements from Research
1. **Audit trail** — Add `sent_to`/`sent_cc` columns to record actual recipients at send time (data integrity critical finding)
2. **RFC 5322 parser** — Use `email-addresses` npm package instead of hand-rolling address parsing (security critical finding)
3. **CEO email → ENV** — Move from settings DB to `CEO_EMAIL` env var; remove from Settings UI
4. **From display name** — Set explicit `From: Roland Spongberg <email>` header in outgoing emails
5. **Type safety** — Add `to` to existing `EmailContent` interface instead of creating a duplicate `ThreadMessage` type; use `Pick<>` for narrowing
6. **Signature caching** — Hoist `getSignature()` out of per-draft loop to eliminate redundant API calls

### New Risks Discovered
- Recipient injection via crafted CC headers on auto-approved drafts (security)
- No audit trail for actual send recipients (data integrity — mitigated by `sent_to`/`sent_cc`)
- `recipient_email` semantic ambiguity after removing generate-drafts overwrite (data integrity — mitigated by always using `trigger_email_from` as fallback)

---

## Overview

When the system sends a draft reply, it currently only replies to the original sender (`trigger_email_from`). This needs to become a full reply-all — and not just to the original trigger email's recipients, but to the **latest message in the Gmail thread** at send time, so the recipient list reflects any new participants who joined the conversation.

## Problem Statement

Bryan sends a "Sales Alert!!" to a distribution list. The system classifies it, drafts a congratulatory reply, but sends it **only to Bryan**. The rest of the team never sees the CEO's response. This defeats the purpose of the congratulatory trigger — the recognition should reach everyone.

Worse, if someone new gets CC'd into the thread between classification and send, they'd be silently excluded. The reply must reflect the thread's **current** participant list, not a snapshot from hours earlier.

## Architectural Decisions

1. **Reply-all is coupled to `reply_in_thread`** — no new trigger flag. If a trigger replies in-thread, it reply-alls. If it sends standalone, it sends to the original sender only (current behavior). If a future trigger needs "reply in thread but only to sender," the flag can be split then.

2. **Recipients are resolved at send time**, not at draft-generation time. The latest thread message is fetched right before sending, and its To/CC become the reply-all list. This guarantees freshness. The resolved recipients are persisted in `sent_to`/`sent_cc` columns for audit purposes.

3. **`recipient_email` stays as-is** — it remains the "primary" To address (the original sender) and serves as fallback when thread fetching fails. For the fallback path, always use `trigger_email_from` (not the LLM-extracted value) to avoid sending to hallucinated addresses.

4. **Extract shared send logic** — the cron and send-now endpoint duplicate thread-fetching and send logic. This change consolidates them into `src/lib/send-draft.ts`. The shared helper **throws on failure** (does not return error objects) so each caller can implement its own error/retry policy.

5. **CEO email is an ENV variable** — `CEO_EMAIL` env var replaces `settings.ceo_email`. The settings DB column and Settings UI field are removed. This prevents accidental changes and keeps the email out of the database.

6. **Use a proper RFC 5322 parser** — Install `email-addresses` npm package for address parsing. Never hand-roll regex-based parsing of email headers.

## Prerequisites (do first, separate commits)

### Prereq A: Move CEO email to ENV variable

**Why:** The CEO email should not be editable in the UI. It's infrastructure config, not a user setting.

**Files:**
- `src/lib/gmail.ts` — All functions currently accept `ceoEmail: string` parameter. Change to read from `process.env.CEO_EMAIL` internally via a helper:

```typescript
function getCeoEmail(): string {
  const email = process.env.CEO_EMAIL;
  if (!email) throw new Error("CEO_EMAIL environment variable is required");
  return email;
}
```

- `src/app/api/cron/poll-classify/route.ts` — Stop reading `settings.ceo_email`, use `process.env.CEO_EMAIL`
- `src/app/api/cron/send-emails/route.ts` — Same
- `src/app/api/drafts/[id]/send-now/route.ts` — Same
- `src/app/api/triggers/test-filter/route.ts` — Same
- `src/app/(protected)/settings/settings-form.tsx` — Remove CEO email field from the form
- `src/app/api/settings/route.ts` — Stop accepting `ceo_email` in the update body
- `src/lib/types.ts` — Remove `ceo_email` from `Settings` interface
- `supabase/migrations/009_drop_ceo_email_from_settings.sql`:

```sql
ALTER TABLE settings DROP COLUMN ceo_email;
```

- `.env.example` — Ensure `CEO_EMAIL` is documented (already listed)
- Vercel — Set `CEO_EMAIL` env var in production

**Refactor approach:** Since `ceoEmail` is passed as the first argument to nearly every function in `gmail.ts`, the cleanest approach is to have each function call `getCeoEmail()` internally and remove the parameter. This eliminates 10+ call sites passing the same value.

### Prereq B: Fix `recipient_email` overwrite in generate-drafts

**File:** `src/app/api/cron/generate-drafts/route.ts`

Remove `recipient_email: draft.trigger_email_from` from the update object (currently line ~140). This is a standalone bug — the overwrite was redundant for filter triggers and destructive for LLM triggers.

**Safety note:** For standalone (non-thread) sends, the fallback path in `send-draft.ts` will explicitly use `draft.trigger_email_from` as the To address, not `draft.recipient_email`. This prevents the LLM-extracted value from being used as a send target.

### Prereq C: Add `From` display name to outgoing emails

**File:** `src/lib/gmail.ts` — `sendEmail()` function

Currently the MIME message has no `From:` header — Gmail defaults to the impersonated account's email without a display name. Add:

```typescript
const fromHeader = `From: Roland Spongberg <${getCeoEmail()}>`;
// Add to the headers array
const headers = [
  fromHeader,
  `To: ${actualTo}`,
  // ...
];
```

Gmail allows setting `From` to the impersonated user's address with a display name. The address must match the impersonated account.

## Technical Approach

### Phase 1: Data model changes + dependency

**New dependency:** `npm install email-addresses`

This is a zero-dependency, TypeScript-native RFC 5322 parser. Handles quoted commas in display names, MIME-encoded names, group syntax, and bare addresses.

**Migration:** `supabase/migrations/010_reply_all_columns.sql`

```sql
-- Capture original To header from trigger email (for UI display)
ALTER TABLE drafts ADD COLUMN trigger_email_to text;

-- Audit trail: actual recipients at send time
ALTER TABLE drafts ADD COLUMN sent_to text;
ALTER TABLE drafts ADD COLUMN sent_cc text;
```

All three columns are nullable text. Existing rows get NULL (acceptable). No indexes needed.

**`src/lib/types.ts`** — Add `to` to `EmailContent`:

```typescript
export interface EmailContent {
  messageId: string;
  threadId: string | null;
  from: string;
  to: string;      // <-- new
  cc: string;
  subject: string;
  body: string;
  receivedAt: Date;
}
```

Also add `trigger_email_to`, `sent_to`, `sent_cc` to the `Draft` interface.

**`src/lib/gmail.ts`** — Extract `To` header in `getEmailContent()`:

```typescript
const to = headers.find((h: { name: string }) => h.name === "To")?.value ?? "";
```

**`src/app/api/cron/poll-classify/route.ts`** — Store in draft insert:

```typescript
trigger_email_to: email.to,
```

### Phase 2: Expand thread message fetcher + reply-all resolver

**File:** `src/lib/gmail.ts`

Expand `getLatestThreadMessageId()` → `getLatestThreadMessage()`. Return a `Pick<EmailContent, 'messageId' | 'to' | 'cc' | 'from'>` instead of a plain string, reusing the existing `EmailContent` type rather than creating a duplicate interface.

```typescript
// Narrowed type for thread message headers
type ThreadMessageHeaders = Pick<EmailContent, "messageId" | "to" | "cc" | "from">;

export async function getLatestThreadMessage(
  threadId: string
): Promise<ThreadMessageHeaders | null>
```

- Request `metadataHeaders: ["Message-ID", "To", "Cc", "From", "Reply-To"]`
- Return all values from the last message in the thread
- Return `null` if thread not found (existing behavior)
- **Throw** on malformed headers (keeps `null` meaning exactly one thing: empty/deleted thread)

### Research Insights: Reply-All Algorithm

Per RFC 5322 section 3.6.3, the standard reply-all algorithm:

```typescript
import { parseAddressList } from "email-addresses";

function resolveReplyAllRecipients(
  latestFrom: string,
  latestTo: string,
  latestCc: string | null,
  latestReplyTo: string | null,
  ceoEmail: string,
): { to: readonly string[]; cc: readonly string[] } {
  const parse = (header: string | null): string[] =>
    header
      ? (parseAddressList(header) ?? [])
          .filter((a): a is { address: string } => "address" in a && !!a.address)
          .map((a) => a.address)
      : [];

  const fromAddrs = parse(latestFrom);
  const toAddrs = parse(latestTo);
  const ccAddrs = parse(latestCc);
  const replyToAddrs = parse(latestReplyTo);
  const self = ceoEmail.toLowerCase();
  const isSelf = (addr: string) => addr.toLowerCase() === self;

  // To = Reply-To (or From) + original To, minus self, deduplicated
  const rawTo = [...(replyToAddrs.length ? replyToAddrs : fromAddrs), ...toAddrs]
    .filter((addr) => !isSelf(addr));
  const seenTo = new Set<string>();
  const newTo = rawTo.filter((addr) => {
    const lower = addr.toLowerCase();
    if (seenTo.has(lower)) return false;
    seenTo.add(lower);
    return true;
  });

  // Cc = original Cc, minus self, minus anyone already in To
  const newCc = ccAddrs.filter(
    (addr) => !isSelf(addr) && !seenTo.has(addr.toLowerCase())
  );

  return { to: newTo, cc: newCc };
}
```

**Where this lives:** As a non-exported function in `src/lib/send-draft.ts` (co-located with the shared send helper that calls it). It has exactly one caller. Per pattern analysis, `gmail.ts` is a thin API wrapper — business logic like recipient resolution belongs in the domain module that uses it.

**Key design decisions from research:**
- Use `readonly string[]` internally, join to comma-separated only at the `sendEmail()` boundary
- Include `Reply-To` header in the thread fetch (Gmail supports it; some senders set Reply-To different from From)
- Always strip CEO address as final step, regardless of whether CEO is in From, To, or Cc
- If stripping leaves To empty → fall back to `draft.trigger_email_from`

### Phase 3: Shared send helper

**New file:** `src/lib/send-draft.ts`

Named after the domain action (not `send-helper.ts`), consistent with `scheduler.ts`, `gmail.ts` naming pattern.

```typescript
import type { Draft, Trigger } from "./types";

type SendableDraft = Omit<Draft, "trigger"> & {
  trigger: Pick<Trigger, "reply_in_thread">;
};

/**
 * Resolves recipients and sends a draft email.
 * Throws on failure — callers implement their own retry/error policy.
 * Persists actual recipients (sent_to, sent_cc) to the draft row.
 */
export async function sendDraft(
  draft: SendableDraft,
  supabase: SupabaseClient,
  redirectTo?: string | null,
): Promise<void>
```

This function:
1. Fetches the CEO email signature **once** (passed in or cached — see performance note)
2. If `trigger.reply_in_thread` is true AND `gmail_thread_id` exists:
   a. Call `getLatestThreadMessage()` to get latest message headers
   b. Call `resolveReplyAllRecipients()` to build the To/CC arrays
   c. If resolution returns empty To → fall back to `draft.trigger_email_from`
   d. Log resolved recipients at `info` level
   e. Call `sendEmail()` with resolved recipients, thread ID, and In-Reply-To
3. If `reply_in_thread` is false (or no thread ID):
   a. Call `sendEmail()` with `draft.trigger_email_from` as To and `draft.trigger_email_cc` as CC
4. After successful send, persist `sent_to` and `sent_cc` to the draft row (audit trail)
5. **Throws on any failure** — does not catch or wrap errors

**Why `trigger_email_from` as fallback, not `recipient_email`:** For LLM-classified triggers, `recipient_email` may contain an address the LLM extracted from the email body (e.g., a person mentioned but not the sender). Using it as a send target in the fallback path could deliver the CEO's reply to an unintended recipient. `trigger_email_from` is always the actual sender — safe as a fallback.

### Phase 4: Wire up call sites + UI

**`src/app/api/cron/send-emails/route.ts`:**
- Fetch signature once before the loop (eliminates N-1 redundant `getSignature()` API calls)
- Replace inline thread-fetch + sendEmail with `sendDraft()` call
- Keep existing: status update to `sent`, retry logic, `send_attempts` increment, `failed` after 3 attempts

**`src/app/api/drafts/[id]/send-now/route.ts`:**
- Replace inline thread-fetch + sendEmail with `sendDraft()` call
- Keep existing: single-attempt error handling (no auto-fail status)

**`src/app/(protected)/dashboard/[id]/draft-editor.tsx`:**
- Show `trigger_email_to` as "Original To" (read-only) when present
- Show `trigger_email_cc` as "Original CC" (already displayed)
- Add note: "This reply will be sent to all participants in the thread" when trigger has `reply_in_thread`
- After send, show `sent_to`/`sent_cc` as "Sent To"/"Sent CC" (read-only, for audit)

## Acceptance Criteria

- [x] `CEO_EMAIL` env var replaces `settings.ceo_email` everywhere; field removed from Settings page
- [x] Outgoing emails show `From: Roland Spongberg <CEO_EMAIL>` in the header
- [x] `email-addresses` package installed for RFC 5322 address parsing
- [x] Incoming emails' `To` header is captured in `trigger_email_to` column
- [x] `getLatestThreadMessage()` returns To, CC, From, Reply-To, and Message-ID from the latest thread message
- [x] `resolveReplyAllRecipients()` follows RFC 5322 reply-all algorithm: deduplicate, strip CEO, handle Reply-To
- [x] Send-emails cron uses reply-all recipients from the latest thread message (when `reply_in_thread` is true)
- [x] Send-now endpoint uses the same shared `sendDraft()` function
- [x] `generate-drafts` no longer overwrites `recipient_email`
- [x] `sent_to` and `sent_cc` columns populated at send time for every sent draft (audit trail)
- [x] Draft editor shows original To/CC and post-send actual recipients
- [x] DEV_MODE correctly redirects all reply-all recipients and shows originals in banner
- [x] Fallback: if latest thread message cannot be fetched, falls back to `trigger_email_from` + `trigger_email_cc`; logged at `warn` level
- [x] CEO is never included as a recipient in the outgoing email
- [x] Signature fetched once per cron batch, not per draft

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| RFC 2822 parsing bugs (hand-rolled regex) | Critical | Use `email-addresses` npm package (RFC 5322 compliant, TypeScript-native, zero deps) |
| No audit trail for actual recipients | Critical | `sent_to`/`sent_cc` columns populated at send time |
| CEO emails themselves (alias not caught) | High | Strip `CEO_EMAIL` from all recipients (lowercase comparison). Document: if CEO has aliases, add `CEO_EMAIL_ALIASES` env var later |
| DEV_MODE leaks real addresses with multi-To | High | Keep `sendEmail` `to` param as comma-separated string (existing redirect logic replaces entire value). Add assertion: if DEV_MODE, verify no address in actualTo/actualCc differs from redirectTo |
| Recipient injection via crafted CC | Medium | Triggers already filter by sender/subject. For extra safety, force `pending_review` for reply-all drafts in a future iteration |
| Thread deleted between classify and send | Medium | Fallback to stored `trigger_email_from` + `trigger_email_cc`; log at `warn` |
| LLM-extracted recipient used as send target | Medium | Fallback path always uses `trigger_email_from`, never `recipient_email` |
| Thread mutation after approval adds new recipients | Low | Acceptable for v1 (CEO's triggers are narrowly scoped). `sent_to`/`sent_cc` provide after-the-fact visibility |

## References

### Internal
- `src/lib/gmail.ts:197` — existing `getLatestThreadMessageId()`
- `src/lib/gmail.ts:248` — existing `sendEmail()` (no From header, no display name)
- `src/lib/gmail.ts:260` — `getSignature()` called per-draft (optimize)
- `src/app/api/cron/send-emails/route.ts:63-119` — cron send logic (duplicate)
- `src/app/api/drafts/[id]/send-now/route.ts:53-100` — send-now logic (duplicate)
- `src/app/api/cron/generate-drafts/route.ts:140` — recipient overwrite (remove)
- `src/app/api/cron/poll-classify/route.ts:~130` — draft insert (add trigger_email_to)
- `src/app/(protected)/settings/settings-form.tsx:83` — CEO email field (remove)

### External
- [email-addresses npm](https://www.npmjs.com/package/email-addresses) — RFC 5322 parser (zero deps, TypeScript-native)
- [Gmail API threads.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get) — metadata format, metadataHeaders filter
- [RFC 5322 §3.6.3](https://www.rfc-editor.org/rfc/rfc5322#section-3.6.3) — Reply-To and recipient semantics
- [Gmail API sending guide](https://developers.google.com/gmail/api/guides/sending) — Raw MIME, threading, From header with display name
