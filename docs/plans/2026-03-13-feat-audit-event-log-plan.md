---
title: "feat: audit event log"
type: feat
status: completed
date: 2026-03-13
---

# Audit Event Log

## Overview

Add an `audit_events` table and admin UI to track who did what and when. Covers draft actions, trigger/settings admin changes, system events (auto-approvals, sends), and auth events (logins). Purpose is accountability — the admin should be able to look back and see a complete timeline of actions.

## Motivation

Currently there's no record of who approved/rejected drafts (beyond `approved_by_email`), who changed trigger configurations, or when system events happened at the per-draft level. The `cron_logs` table tracks cron run summaries but not individual draft outcomes.

## Proposed Solution

### Event Types

| Action | Actor | Entity | Triggered From |
|--------|-------|--------|---------------|
| `draft.approve` | user email | draft | `/api/drafts/[id]/approve` |
| `draft.reject` | user email | draft | `/api/drafts/[id]/reject` |
| `draft.regenerate` | user email | draft | `/api/drafts/[id]/regenerate` |
| `draft.send_now` | user email | draft | `/api/drafts/[id]/send-now` |
| `draft.edit` | user email | draft | `/api/drafts/[id]/edit` |
| `draft.delete` | user email | draft | `/api/drafts/[id]/delete` |
| `draft.unreject` | user email | draft | `/api/drafts/[id]/unreject` |
| `draft.auto_approve` | `system` | draft | `/api/cron/generate-drafts` |
| `draft.send_success` | `system` | draft | `/api/cron/send-emails` |
| `draft.send_failure` | `system` | draft | `/api/cron/send-emails` |
| `trigger.create` | user email | trigger | `/api/triggers` |
| `trigger.update` | user email | trigger | `/api/triggers/[id]` |
| `trigger.delete` | user email | trigger | `/api/triggers/[id]` |
| `settings.update` | user email | settings | `/api/settings` |
| `auth.login` | user email | — | Auth.js signIn callback |
| `auth.login_denied` | attempted email | — | Auth.js signIn callback |

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| FK on `entity_id` | No FK constraint | Soft-deleted drafts still exist but we don't want constraint complexity across entity types |
| Draft deletion | Convert to soft-delete (`deleted_at`) | Preserves draft data for audit trail; consistent with triggers table pattern |
| Cron granularity | One event per draft affected | Gives complete per-draft timeline; `cron_logs` stays for operational summaries |
| Access control | Admin-only page | Consistent with other admin pages (triggers, cron logs) |
| Logging failures | Fire-and-forget with try/catch | Same pattern as `cron-logger.ts`; never break the main operation |
| Overlap with `cron_logs` | Keep both | `cron_logs` = operational monitoring (duration, stats). `audit_events` = per-draft accountability |
| Overlap with `approved_by_email` | Keep both | `approved_by_email` is denormalized for quick display; audit_events is the full history |

## Implementation

### Phase 1: Database migrations

- [x] Add `deleted_at timestamptz` column to `drafts` table
- [x] Create `audit_events` table
- [x] Convert draft hard-delete route to soft-delete

**File:** `supabase/migrations/013_draft_soft_delete.sql`

```sql
-- Add soft-delete to drafts (triggers already have this)
ALTER TABLE drafts ADD COLUMN deleted_at timestamptz;
CREATE INDEX idx_drafts_deleted_at ON drafts (deleted_at) WHERE deleted_at IS NULL;
```

**File:** `supabase/migrations/014_audit_events.sql`

```sql
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  actor_email text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Primary query: chronological feed (admin page)
CREATE INDEX idx_audit_events_created_at ON audit_events (created_at DESC);

-- Filter by action type
CREATE INDEX idx_audit_events_action ON audit_events (action, created_at DESC);

-- Per-entity timeline (e.g., all events for a specific draft)
CREATE INDEX idx_audit_events_entity ON audit_events (entity_type, entity_id, created_at DESC);
```

### Phase 2: Soft-delete for drafts

- [x] Update `Draft` interface in `src/lib/types.ts` — add `deleted_at: string | null`
- [x] Change `/api/drafts/[id]/delete/route.ts` — `UPDATE ... SET deleted_at = now()` instead of `DELETE`
- [x] Add `.is("deleted_at", null)` filter to all draft queries (dashboard, history, detail page)

**File:** `src/app/api/drafts/[id]/delete/route.ts`

```typescript
// Before: hard delete
// await supabase.from("drafts").delete().eq("id", id);

// After: soft delete
await supabase.from("drafts").update({ deleted_at: new Date().toISOString() }).eq("id", id);
```

**Files to add `.is("deleted_at", null)` filter:**
- `src/app/(protected)/dashboard/page.tsx` — main draft list
- `src/app/(protected)/dashboard/history/page.tsx` — history page
- `src/app/(protected)/dashboard/[id]/page.tsx` — draft detail (return 404 if soft-deleted)

### Phase 3: Audit logger utility

- [x] Create `src/lib/audit-logger.ts` with `logAuditEvent()` function
- [x] Add `AuditEvent` interface to `src/lib/types.ts`

**File:** `src/lib/audit-logger.ts`

```typescript
import { logger } from "./logger";
import type { SupabaseClient } from "@supabase/supabase-js";

interface AuditEventInput {
  action: string;
  actorEmail: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget audit event insert. Never throws. */
export async function logAuditEvent(
  supabase: SupabaseClient,
  event: AuditEventInput,
): Promise<void> {
  try {
    await supabase.from("audit_events").insert({
      action: event.action,
      actor_email: event.actorEmail,
      entity_type: event.entityType ?? null,
      entity_id: event.entityId ?? null,
      metadata: event.metadata ?? {},
    });
  } catch (error) {
    logger.error(
      `Failed to log audit event: ${event.action}`,
      "audit",
      { error: String(error), event },
    );
  }
}
```

**File:** `src/lib/types.ts` — add interface

```typescript
export interface AuditEvent {
  id: string;
  action: string;
  actor_email: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
```

### Phase 4: Instrument API routes

- [x] Add `logAuditEvent()` calls to all 7 draft action routes
- [x] Add `logAuditEvent()` calls to trigger CRUD routes
- [x] Add `logAuditEvent()` calls to settings update route
- [x] Add `logAuditEvent()` calls to cron routes (per-draft events)
- [x] Add `logAuditEvent()` call to Auth.js signIn callback

Each call goes **after** the successful mutation, **before** the return statement. Examples:

**File:** `src/app/api/drafts/[id]/approve/route.ts`

```typescript
await logAuditEvent(supabase, {
  action: "draft.approve",
  actorEmail: session.user.email!,
  entityType: "draft",
  entityId: id,
  metadata: { edited: body !== draft.body },
});
```

**File:** `src/app/api/cron/send-emails/route.ts` (inside the per-draft send loop)

```typescript
// After successful send:
await logAuditEvent(supabase, {
  action: "draft.send_success",
  actorEmail: "system",
  entityType: "draft",
  entityId: draft.id,
  metadata: { bcc: bcc },
});

// On send failure:
await logAuditEvent(supabase, {
  action: "draft.send_failure",
  actorEmail: "system",
  entityType: "draft",
  entityId: draft.id,
  metadata: { error: String(error), attempt: draft.send_attempts + 1 },
});
```

**File:** `src/auth.ts` (signIn callback)

```typescript
async signIn({ user }) {
  const email = user.email;
  if (!email || !allowedEmails.includes(email.toLowerCase())) {
    // Log denied attempt (need supabase client here)
    await logAuditEvent(supabase, {
      action: "auth.login_denied",
      actorEmail: email ?? "unknown",
    });
    return false;
  }
  await logAuditEvent(supabase, {
    action: "auth.login",
    actorEmail: email,
  });
  return true;
}
```

### Phase 5: Admin activity page

- [x] Create `src/app/(protected)/admin/activity/page.tsx` — server component
- [x] Add nav entry to `src/app/(protected)/layout.tsx`
- [x] Support filters: action type (tabs or dropdown), date range, pagination

**File:** `src/app/(protected)/admin/activity/page.tsx`

Modeled after the cron-logs page pattern:
- Server Component (async function)
- `searchParams` for filter state (`?action=draft.approve&page=1`)
- Fetches from `audit_events` ordered by `created_at DESC`
- Cursor-based pagination (50 per page)
- Tab-style filter by action category (`draft.*`, `trigger.*`, `settings.*`, `auth.*`, or "All")
- Table columns: Time, Actor, Action, Entity, Details
- Entity column links to draft/trigger detail page when applicable
- Uses `formatDate()` with CEO timezone
- Badge component for action type with color coding

**File:** `src/app/(protected)/layout.tsx` — add nav item

```typescript
const adminNavItems = [
  { href: "/admin/triggers", label: "Triggers" },
  { href: "/admin/cron-logs", label: "Logs" },
  { href: "/admin/activity", label: "Activity" },  // NEW
];
```

## Acceptance Criteria

- [x] `audit_events` table exists with proper indexes
- [x] Drafts use soft-delete (`deleted_at`) instead of hard-delete
- [x] All 7 draft action routes log audit events with actor email
- [x] Trigger CRUD routes log audit events
- [x] Settings update route logs audit events
- [x] Cron send-emails logs per-draft `send_success`/`send_failure` events
- [x] Cron generate-drafts logs per-draft `auto_approve` events
- [x] Auth login/denied events are logged
- [x] Admin activity page shows chronological event list
- [x] Activity page has category filter tabs
- [x] Activity page has pagination (50 per page)
- [x] Timestamps display in CEO timezone
- [x] Audit logging failures never break the main operation
- [x] Existing dashboard/history queries exclude soft-deleted drafts

## References

- `supabase/migrations/002_cron_logs.sql` — migration pattern
- `src/lib/cron-logger.ts` — fire-and-forget logger pattern
- `src/app/(protected)/admin/cron-logs/page.tsx` — admin page template
- `src/app/(protected)/layout.tsx:15-18` — admin nav registration
- `src/app/api/drafts/[id]/approve/route.ts` — API route pattern (standard auth)
- `src/app/api/drafts/[id]/delete/route.ts` — API route pattern (admin auth)
- `src/lib/admin.ts` — `isAdmin()` utility
- `src/auth.ts` — Auth.js config with signIn callback
- `src/lib/types.ts` — TypeScript interfaces
