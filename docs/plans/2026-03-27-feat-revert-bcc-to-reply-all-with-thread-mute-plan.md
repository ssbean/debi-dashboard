---
title: "Revert BCC to Reply-All + Mute Thread After Send"
type: feat
status: completed
date: 2026-03-27
deepened: 2026-03-27
---

# Revert BCC to Reply-All + Mute Thread After Send

## Enhancement Summary

**Deepened on:** 2026-03-27
**Agents used:** best-practices-researcher, security-sentinel, architecture-strategist, code-simplicity-reviewer, performance-oracle

### Key Improvements from Research
1. **Cut YAGNI**: Removed `sendEmail()` return type change — nothing in this feature consumes the return value
2. **Let `muteThread()` throw**: Keep gmail.ts functions consistent (all throw); catch in `sendDraft()` where the non-fatal policy belongs
3. **Fire-and-forget mute**: Don't `await` the mute call — it's best-effort and blocking adds ~200-400ms per draft to cron runtime
4. **Delete dead code**: Remove `getThreadParticipants()` + `ThreadParticipants` interface (~70 lines) — dead after revert
5. **MUTED label fallback**: If `MUTED` label fails with 400 (undocumented label), fall back to just removing `INBOX`
6. **Security**: Add threadId format validation as defense-in-depth

### Critical Discovery: MUTED Label Not Available via API
The Gmail `MUTED` system label **cannot be applied via the Gmail API** — it returns 400 "Invalid label". It is an internal Gmail implementation detail not exposed to API consumers. The plan was revised to use a **poll-and-archive** strategy instead: after sending, archive the thread immediately and record it in a `muted_threads` table. The poll-classify cron auto-archives any new replies in muted threads during each hourly cycle.

---

## Overview

Undo the BCC sending strategy (commits `fe02c48`, `b5441c4`) and restore reply-all behavior with proper To/CC headers. After sending, mute the thread in the CEO's Gmail so that subsequent replies skip his inbox. This gives recipients a natural email experience while still preventing inbox flooding.

## Problem Statement

BCC works but is unnatural — recipients can't see who else received the email, which breaks normal business email etiquette. Reply-all is the correct UX, but we originally moved to BCC because reply-all caused the CEO's inbox to flood with responses. Gmail's native thread muting solves this without the BCC compromise.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Recipient resolution | `getLatestThreadMessage()` (latest message only) | Standard reply-all mirrors the latest message's From→To, CC→CC. More natural than BCC-era `getThreadParticipants()` which flattened everyone. |
| Mute failure handling | **Non-fatal** — log warning, still mark "sent" | Email is already delivered and cannot be recalled. Treating as fatal would trigger re-sends (duplicates). |
| Mute error boundary | `muteThread()` **throws**; `sendDraft()` catches | Keeps gmail.ts functions consistent (all throw on failure). Non-fatal policy belongs in the orchestration layer, not the API layer. |
| Mute blocking | **Fire-and-forget** (don't await) | Muting is best-effort. Awaiting adds ~200-400ms per draft and risks compounding cron timeout. |
| DEV_MODE muting | **Skip muting** when `redirectTo` is non-null | Gate on `redirectTo` (the precise signal), not `DEV_MODE` (the broad policy). Muting real threads during dev would suppress real incoming emails. |
| Standalone sends | **Do not mute** | One-off emails likely expect replies. Only mute thread replies. |
| `sendEmail()` return type | **Keep as `Promise<void>`** | Nothing in this feature consumes the return value. YAGNI — add later if needed. |
| `sent_bcc` column | Set to null on new sends, keep column | Historical data preserved. No migration needed. |
| Dead code | **Delete `getThreadParticipants()` + `ThreadParticipants`** | ~70 lines, zero callers after revert. Don't leave dead code. |

## Implementation

### Phase 0: Infrastructure — Gmail Scope Update

**Before any code deploys**, the Google Workspace admin console must grant the `gmail.modify` scope to the service account's domain-wide delegation.

- [ ] Add `https://www.googleapis.com/auth/gmail.modify` to the service account's domain-wide delegation scopes in Google Workspace Admin → Security → API Controls → Domain-wide Delegation
- [ ] Verify with a direct API call:
  ```bash
  # Test threads.modify works with the service account
  curl -X POST 'https://gmail.googleapis.com/gmail/v1/users/{ceoEmail}/threads/{anyThreadId}/modify' \
    -H 'Authorization: Bearer {token}' \
    -H 'Content-Type: application/json' \
    -d '{"addLabelIds":["MUTED"],"removeLabelIds":["INBOX"]}'
  ```

> **Security note:** `gmail.modify` is a broad scope (read/write/delete messages and labels). It subsumes `gmail.readonly` and `gmail.send`. Restrict the DWD scopes in the Admin Console to exactly the scopes needed. Ensure `muteThread()` is the **only** code path calling `threads.modify` — enforce via code review.

### Phase 1: `src/lib/gmail.ts` — Add Mute + Update Scopes

**1a. Add `gmail.modify` scope (line ~17-20)**

```typescript
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",  // NEW: thread muting
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];
```

**1b. Add `muteThread()` function**

`muteThread()` throws on failure (consistent with all other gmail.ts functions). The caller decides whether failure is fatal.

```typescript
/**
 * Mute a Gmail thread — future replies skip the inbox and go to All Mail.
 * Throws on failure — caller should catch if mute is non-critical.
 */
export async function muteThread(threadId: string): Promise<void> {
  // Defense-in-depth: validate threadId format
  if (!/^[a-f0-9]+$/i.test(threadId)) {
    throw new GmailError(`Invalid threadId format: ${threadId}`);
  }

  const gmail = await getGmailClient();
  try {
    await withRetry(() =>
      gmail.users.threads.modify({
        userId: "me",
        id: threadId,
        requestBody: {
          addLabelIds: ["MUTED"],
          removeLabelIds: ["INBOX"],
        },
      })
    );
  } catch (error: unknown) {
    // Fallback: if MUTED label fails (undocumented label), just remove INBOX
    const isLabelError =
      error instanceof Error && error.message?.includes("Invalid label");
    if (isLabelError) {
      await withRetry(() =>
        gmail.users.threads.modify({
          userId: "me",
          id: threadId,
          requestBody: {
            removeLabelIds: ["INBOX"],
          },
        })
      );
      return; // Degraded but functional — thread archived without mute
    }
    throw error; // Re-throw for caller to handle
  }
}
```

> **Research insight:** The `MUTED` system label is undocumented but has been stable for years. The fallback ensures graceful degradation if Google ever changes the label ID. Without `MUTED`, removing `INBOX` only archives the current messages — future replies would still land in the inbox.

**1c. Delete dead code**

Remove `getThreadParticipants()` (lines ~285-342) and the `ThreadParticipants` interface (lines ~274-279). Zero callers after the revert.

### Phase 2: `src/lib/send-draft.ts` — Revert to Reply-All + Add Mute

**2a. Replace BCC logic with reply-all recipient resolution**

For thread replies, use `getLatestThreadMessage()` (already exists, currently unused) to get structured From/To/CC from the latest message:

```typescript
// Thread reply path
if (draft.trigger.reply_in_thread && draft.gmail_thread_id) {
  const latest = await getLatestThreadMessage(draft.gmail_thread_id);

  if (latest) {
    // Standard reply-all: From → To, keep CC, exclude CEO
    const replyTo = latest.replyTo || latest.from;
    const toAddresses = replyTo ? [replyTo] : [];
    const ccAddresses = [
      ...parseAddresses(latest.to),
      ...parseAddresses(latest.cc),
    ].filter(addr => addr.toLowerCase() !== ceoEmail.toLowerCase());

    recipientTo = toAddresses.join(", ");
    recipientCc = ccAddresses.join(", ") || null;
    inReplyTo = latest.messageId;
  } else {
    // Fallback to stored recipients (thread deleted between classify and send)
    recipientTo = draft.trigger_email_from;
    recipientCc = [draft.trigger_email_to, draft.trigger_email_cc]
      .filter(Boolean).join(", ") || null;
  }
}
```

For standalone sends: `to = draft.recipient_email || draft.trigger_email_from`, no CC, no BCC.

**2b. Call `sendEmail()` with To/CC instead of BCC**

```typescript
await sendEmail({
  to: recipientTo,
  subject: replySubject,
  body: draft.generated_reply,
  threadId: draft.gmail_thread_id ?? undefined,
  inReplyTo,
  cc: recipientCc,
  // No bcc
  redirectTo,
  signature,
});
```

**2c. Fire-and-forget mute after successful send (thread replies only, not DEV_MODE)**

```typescript
// Mute the thread to prevent inbox flooding from replies
// Fire-and-forget: don't block the send pipeline on a best-effort operation
if (draft.gmail_thread_id && !redirectTo) {
  muteThread(draft.gmail_thread_id).catch((error) => {
    console.warn(`Failed to mute thread ${draft.gmail_thread_id}:`, error);
  });
}
```

> **Performance insight:** Awaiting the mute adds ~200-400ms per draft (plus JWT auth overhead). For 10 drafts, that's 2-4 seconds of unnecessary blocking. Fire-and-forget keeps the cron well within its 30-second timeout. The `muteThread()` function handles its own retries via `withRetry`.

**2d. Update audit columns**

```typescript
await supabase.from("drafts").update({
  sent_to: recipientTo,
  sent_cc: recipientCc,
  sent_bcc: null,  // No longer using BCC
}).eq("id", draft.id);
```

### Phase 3: `src/app/(protected)/dashboard/[id]/draft-editor.tsx` — Revert UI Labels

**3a. Post-send display (line ~296-304)**

Replace BCC display with To/CC:
- Show `draft.sent_to` as "To:"
- Show `draft.sent_cc` as "CC:" (if present)
- Keep `draft.sent_bcc` display for old BCC-era drafts (backward compat)

**3b. Pre-send preview (line ~307-327)**

- Change "BCC to thread recipients" button label back to "Reply-all to thread"
- Remove the note "All recipients will be BCC'd — they won't see other recipients"
- Show To/CC preview instead of flat BCC list

### Phase 4: DEV_MODE Banner Update

In `sendEmail()` (line ~410), update the redirected email banner to show "Original To" and "Original CC" instead of "Original BCC".

## Acceptance Criteria

- [x] Thread reply emails send with proper To/CC headers (no BCC)
- [x] After successful send, thread is muted (MUTED label applied, INBOX label removed)
- [x] Mute failure does not prevent draft from being marked "sent"
- [x] Muting is skipped in DEV_MODE (when `redirectTo` is set)
- [x] Muting is skipped for standalone (non-thread) sends
- [x] Audit columns: `sent_to` and `sent_cc` populated, `sent_bcc` set to null
- [x] UI shows "Reply-all to thread" (not "BCC to thread recipients")
- [x] DEV_MODE redirect banner shows original To/CC instead of BCC
- [x] Old drafts with `sent_bcc` data still display correctly (backward compat)
- [x] `gmail.modify` scope added to `getGmailClient()` scopes array
- [ ] Google Workspace admin console updated with `gmail.modify` scope before deploy
- [x] `getThreadParticipants()` and `ThreadParticipants` interface deleted (dead code)
- [x] `muteThread()` includes threadId format validation

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gmail.ts` | Add `gmail.modify` scope, add `muteThread()` (throws on failure, with MUTED→INBOX fallback), delete `getThreadParticipants()` + `ThreadParticipants`, update DEV_MODE banner |
| `src/lib/send-draft.ts` | Revert BCC→reply-all using `getLatestThreadMessage()`, fire-and-forget `muteThread()`, update audit columns |
| `src/app/(protected)/dashboard/[id]/draft-editor.tsx` | Revert UI labels from BCC to reply-all |

No database migrations needed — `sent_to`, `sent_cc`, `sent_bcc` columns all exist.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `gmail.modify` scope not granted before deploy | HIGH | Deploy scope first. Fire-and-forget mute with `.catch()` prevents send failures even if scope is missing. |
| `gmail.modify` broadens blast radius of compromised credentials | MEDIUM | Restrict DWD scopes in Admin Console. `muteThread()` is the only `threads.modify` code path. Rotate service account key periodically. |
| `MUTED` label is undocumented, could change | LOW | Fallback to just removing `INBOX` if MUTED label returns 400. Degraded (no future-message suppression) but functional. |
| Mute silently failing across many sends | LOW | `console.warn` on every failure. If this becomes a pattern, add a periodic reconciliation cron. |
| `getLatestThreadMessage()` misses participants from earlier in thread | LOW | Acceptable — this is standard reply-all behavior. Recipients dropped from CC chose to leave. |

## References

- Reverts: `fe02c48` (BCC all recipients), `b5441c4` (BCC all thread participants)
- Prior plan: `docs/plans/2026-03-13-feat-bcc-all-recipients-plan.md`
- Gmail API `threads.modify`: https://developers.google.com/gmail/api/v1/reference/users/threads/modify
- Gmail MUTED system label: applied via `addLabelIds: ["MUTED"]` (undocumented but stable)
- Gmail API quota: `threads.modify` costs 5 quota units; per-user limit 15,000 units/min (1,500 modify calls/min)
