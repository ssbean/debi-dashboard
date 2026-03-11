---
date: 2026-02-17
topic: trigger-match-modes
---

# Trigger Match Modes: LLM vs Gmail Filters

## What We're Building

Triggers currently only support LLM-based classification — every incoming email is sent to Claude along with all trigger descriptions for matching. We want triggers to optionally use Gmail filter criteria instead, allowing cheap deterministic matching without an LLM call. Each trigger chooses its own match mode.

## Why This Approach

Three options were considered:

1. **LLM-only (status quo)** — flexible but every email costs tokens, even obvious matches.
2. **Gmail filters only** — fast and free but can't handle nuanced classification.
3. **Per-trigger match mode (chosen)** — each trigger picks its strategy. Simple cases use Gmail filters; nuanced cases use LLM. A hybrid mode narrows candidates with filters then scores with LLM.

The per-trigger approach gives the most control without adding system-wide complexity.

## Key Decisions

- **Match mode enum**: `llm` | `gmail_filter` | `gmail_filter_llm`
  - `llm`: Current behavior. Description sent to Claude for classification.
  - `gmail_filter`: Match by Gmail query locally against already-fetched email content. Auto-match at 100% confidence, no LLM call.
  - `gmail_filter_llm`: Gmail query narrows candidates, then Claude scores confidence and extracts recipient for that single trigger.

- **Filter definition**: Structured fields (from domain, subject contains) plus an "Advanced" toggle for raw Gmail query syntax. Structured fields get composed into a query string at save time or match time.

- **New trigger columns**:
  - `match_mode` text NOT NULL DEFAULT 'llm'
  - `gmail_filter_query` text (raw Gmail query for advanced mode)
  - `gmail_filter_from` text (from domain/address for structured mode)
  - `gmail_filter_subject` text (subject contains for structured mode)

- **Classification flow** (poll-classify changes):
  1. Fetch emails as today (company domain filter from Gmail API).
  2. For each email, evaluate Gmail-filter triggers first using local string matching against the email's from/subject fields. This is free — no API call needed since we already have the email content.
  3. If a `gmail_filter` trigger matches: create draft at 100% confidence, skip LLM. Recipient defaults to the email sender (or a configured default on the trigger if added later).
  4. If a `gmail_filter_llm` trigger matches: call Claude with only that trigger's description for scoring + recipient extraction.
  5. If no Gmail-filter trigger matched: run remaining `llm` triggers through Claude as today (batch all LLM triggers in one call).
  6. First match wins — once an email matches a trigger, stop checking further triggers (preserves current sort_order priority behavior).

- **UI changes**:
  - Radio group for match mode in the trigger form dialog.
  - When `llm`: show description textarea (current behavior).
  - When `gmail_filter` or `gmail_filter_llm`: show structured filter fields (From domain, Subject contains) with an "Advanced" toggle that reveals a raw Gmail query textarea. Also show description textarea for `gmail_filter_llm` since it's still used by Claude.

- **Local matching logic**: Simple case-insensitive string matching — `from` field checked with `includes()`, subject checked with `includes()`. For advanced raw queries, parse basic Gmail operators (`from:`, `subject:`, `OR`, `-`) into a matcher. No need to support the full Gmail query language; complex queries can use `gmail_filter_llm` mode which lets Claude handle the nuance.

## Open Questions

- Should we support a default recipient on Gmail-filter triggers (for cases where the reply-to isn't the sender)?
- Should `gmail_filter` triggers still show in the LLM prompt as "already matched" context, or be fully invisible to Claude?
- Rate/priority: if multiple Gmail-filter triggers match the same email, use sort_order (first wins) — confirm this is desired.

## Next Steps

-> `/workflows:plan` for implementation details
