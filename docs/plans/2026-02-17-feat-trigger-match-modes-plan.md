---
title: "feat: Add trigger match modes (LLM vs Gmail filter)"
type: feat
status: active
date: 2026-02-17
---

# Add Trigger Match Modes

## Overview

Each trigger can now be either LLM-based (current behavior — Claude classifies) or Gmail-filter-based (pass the query to Gmail API to find matching emails, 100% confidence, zero token cost). Filter triggers are evaluated first via separate Gmail API calls, then remaining unmatched emails go through LLM classification.

## Why This Approach

- **Binary choice** (`llm` vs `gmail_filter`) keeps it simple — no hybrid mode complexity.
- **Gmail API does the filtering** — no custom parser needed. The `gmail_filter_query` is passed directly to `messages.list` as the `q` parameter. Gmail handles all query syntax natively.
- **Filters first** evaluation order maximizes token savings.

## Key Decisions

- `match_mode` defaults to `'llm'` so existing triggers are unchanged after migration.
- `gmail_filter` triggers call the Gmail API with the trigger's query to find matching message IDs. Matched emails get 100% confidence, no LLM call.
- Emails matched by a filter trigger are excluded from LLM classification.
- `gmail_filter_query` stores raw Gmail query syntax (e.g. `from:company.com subject:invoice`). This is passed directly to the Gmail API — no local parsing.
- All form fields (description, gmail_filter_query) are always visible in the UI. Validation enforces the relevant field based on mode.
- `created_by_email` and `updated_by_email` audit fields added to triggers.
- Cron logging uses existing token counts to distinguish match types (0 tokens = filter match). No new log fields.
- Add Zod validation to trigger API routes for the new fields, with 500 char max on `gmail_filter_query`.
- DB constraint enforces `gmail_filter_query IS NOT NULL` when `match_mode = 'gmail_filter'`.

## Acceptance Criteria

- [ ] Existing triggers default to `llm` mode after migration
- [ ] Admin can create/edit triggers with `gmail_filter` mode and enter a Gmail query
- [ ] Admin can create/edit triggers with `llm` mode (unchanged behavior)
- [ ] `gmail_filter` triggers query Gmail API first in poll-classify
- [ ] `gmail_filter` match creates draft at 100% confidence with zero tokens
- [ ] Emails matched by filter are excluded from LLM classification
- [ ] `llm` triggers still batch into a single Claude call (current behavior)
- [ ] Trigger list shows match mode badge
- [ ] Trigger API validates input with Zod

## Implementation

### 1. Migration: `supabase/migrations/004_add_match_mode.sql`

```sql
ALTER TABLE triggers
  ADD COLUMN match_mode text NOT NULL DEFAULT 'llm'
    CHECK (match_mode IN ('llm', 'gmail_filter')),
  ADD COLUMN gmail_filter_query text
    CHECK (gmail_filter_query IS NULL OR (length(gmail_filter_query) BETWEEN 1 AND 500)),
  ADD COLUMN created_by_email text,
  ADD COLUMN updated_by_email text;

-- Enforce: gmail_filter mode requires a query
ALTER TABLE triggers
  ADD CONSTRAINT check_gmail_filter_query
  CHECK (
    (match_mode = 'llm')
    OR
    (match_mode = 'gmail_filter' AND gmail_filter_query IS NOT NULL)
  );
```

### 2. Types: `src/lib/types.ts`

Add to `Trigger` interface:

```typescript
match_mode: 'llm' | 'gmail_filter';
gmail_filter_query: string | null;
```

### 3. Gmail API filter fetch: `src/lib/gmail.ts`

Add a new exported function that queries Gmail with a trigger's filter query and returns matching message IDs:

```typescript
export async function fetchFilteredEmailIds(
  ceoEmail: string,
  since: Date,
  filterQuery: string,
): Promise<string[]>
```

This calls `messages.list` with `q: "${filterQuery} after:${sinceEpoch} is:unread"` and returns the message IDs. Reuses the existing `getGmailClient` and `withRetry` helpers.

### 4. Poll-classify: `src/app/api/cron/poll-classify/route.ts`

Revised flow:

1. Fetch settings and all enabled triggers as today.
2. Split triggers: `filterTriggers` and `llmTriggers`.
3. **Filter phase**: For each `gmail_filter` trigger, call `fetchFilteredEmailIds()` with its query. Collect matched message IDs into a `Map<messageId, triggerId>`.
4. **Fetch emails**: Call `fetchNewEmails()` as today to get all candidate emails.
5. **Process emails**: For each email:
   - If `messageId` is in the filter matches map → create draft at 100% confidence, skip LLM.
   - Otherwise → accumulate for LLM classification.
6. **LLM phase**: For remaining emails, call `classifyEmail()` with `llmTriggers` as today.

This means filter triggers add one Gmail API call each (cheap, no tokens), and matched emails never hit Claude.

### 5. Trigger form UI: `src/app/(protected)/admin/triggers/triggers-manager.tsx`

- Add `match_mode` and `gmail_filter_query` to form state (default `'llm'` and `''`).
- Radio group: "LLM Classification" / "Gmail Filter".
- Always show both description textarea and gmail_filter_query input.
- Validation on save: `gmail_filter` mode requires non-empty `gmail_filter_query`. `llm` mode requires non-empty `description`.
- Add `match_mode` and `gmail_filter_query` to `openEdit()` and `resetForm()`.
- Show `Badge` for match mode in trigger list cards.

### 6. Trigger API routes: `src/app/api/triggers/route.ts` and `[id]/route.ts`

- Add Zod schema validation for all trigger fields.
- Accept `match_mode` and `gmail_filter_query` in POST and PUT bodies.
- Record `created_by_email` / `updated_by_email` from session.
- Pass validated data through to Supabase.

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/004_add_match_mode.sql` | New migration |
| `src/lib/types.ts` | Add fields to Trigger interface |
| `src/lib/gmail.ts` | Add `fetchFilteredEmailIds()` function |
| `src/app/api/cron/poll-classify/route.ts` | Filter-first flow, exclude matched emails from LLM |
| `src/app/(protected)/admin/triggers/triggers-manager.tsx` | Match mode UI |
| `src/app/api/triggers/route.ts` | Zod validation, accept new fields, audit fields |
| `src/app/api/triggers/[id]/route.ts` | Zod validation, accept new fields, audit fields |

## Verification

1. Run migration — existing triggers get `match_mode='llm'`, `gmail_filter_query=null`
2. Create a `gmail_filter` trigger with query `from:test.com`
3. Create an `llm` trigger (unchanged flow)
4. Run poll-classify — confirm filter trigger queries Gmail API and matches at 100%, 0 tokens
5. Confirm unmatched emails still go through LLM classification
6. Confirm token counts in cron logs reflect savings
