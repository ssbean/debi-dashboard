# Debi UX Improvements Brainstorm

**Date:** 2026-03-07
**Status:** Draft

---

## What We're Exploring

The dashboard is functionally working — emails are being classified, drafts are being generated, and Debi can approve/reject them. But there are two critical gaps for Debi's actual workflow:

1. **She won't know there's anything to review** unless she proactively checks the dashboard.
2. **The dashboard is built for the developer**, not the EA — it shows confidence scores, pipeline stats, status codes with underscores, and other technical details she doesn't need.

---

## User Context

- **Who:** Debi Pellegrino, Chief of Staff to the CEO (Roland). Non-technical user.
- **Job:** Review AI-drafted replies before they go out under Roland's name.
- **Preference:** Simpler is better. She wants to see what needs action, act on it, and move on.
- **Edit behavior:** Sales Alert replies — probably approve as-is. Welcome emails — may want to tweak.
- **Volume:** Low. A handful of drafts per week across 3 trigger types.

---

## Key Problems to Solve

### Problem 1: No notification (highest priority)
She doesn't know drafts exist unless she opens the URL. This is the biggest barrier to real usage.

### Problem 2: Dashboard is developer-facing
Current dashboard shows:
- 5 stat cards (emails scanned, matched, pending review, auto-approved, sent) — not relevant to Debi
- Confidence scores on each draft — not meaningful to her
- Raw status labels with underscores (`pending_review`, `auto_approved`)
- To/CC displayed as raw email strings in a dense single line

### Problem 3: Navigation friction
She has to click into each draft, read it, decide, click a button, get taken back to the list, and repeat. No way to quickly scan and act.

---

## Proposed Approaches

### Option A: Notification + Light UI Polish ✅ Recommended

**What it is:** Add a Google Chat notification when new drafts hit `pending_review`. Clean up the dashboard language and hide developer-facing elements from Debi's view.

**Notification:** POST to a Google Chat incoming webhook when the generate-drafts cron creates new drafts. Message includes the draft subject, trigger type, and a direct link to review.

**UI cleanup:**
- Remove stats cards from Debi's view (or move to an admin view)
- Remove confidence scores from the list
- Replace status labels: `pending_review` → "Needs Review", `sent` → "Sent", `rejected` → "Rejected"
- Show the "needs review" drafts prominently at top; archive the rest
- Dashboard title: "Roland's Drafts" or just "Pending Review"

**Pros:** High impact, low effort. Notification solves the biggest problem. UI cleanup takes a few hours.
**Cons:** Still requires opening the dashboard to approve/reject. No friction reduction in the review step itself.
**Best for:** Getting Debi meaningfully using the tool quickly.

---

### Option B: Notification + Inbox Redesign

**What it is:** Everything in Option A, plus redesign the dashboard as a focused inbox with inline approve/reject actions on each list item — no need to click into the draft detail unless she wants to edit.

**UI changes:**
- Each list item expands or shows a preview of the draft body on hover/click
- Approve and Reject buttons directly on the list card
- Detail page still exists for editing

**Pros:** Significantly reduces clicks for simple approvals. Better mobile experience.
**Cons:** More frontend work. Editing still requires the detail page, so the savings are mainly for straightforward approvals.
**Best for:** When we know Debi is using it and wants to move faster.

---

### Option C: Google Chat Bot with Interactive Approve Button

**What it is:** A real Google Chat bot (not just a webhook) that sends an interactive card with Approve/Reject buttons directly in the chat message. Debi never needs to open the dashboard for simple approvals.

**Pros:** Lowest friction possible. Approve without leaving Google Chat.
**Cons:** Significantly more complex (bot setup, OAuth, event handling). May feel risky to Debi if she can't see the draft before approving. Google Chat bot setup requires Google Workspace admin approval.
**Best for:** Later, once she's comfortable with the flow and trusts the draft quality.

---

## Why Option A First

Notifications are the unlock. Until Debi knows a draft exists, nothing else matters. Option A is a half-day of work that removes the most critical blocker. Option B is the natural next step after she's been using it for a week or two — we'll have a feel for her actual review patterns. Option C is aspirational and can be revisited once draft quality is proven.

---

## Key Decisions

- **Notification channel:** Google Chat (incoming webhook, no bot required for Option A)
- **Trigger for notification:** When generate-drafts cron creates new `pending_review` drafts
- **Notification batching:** Send one message per cron run if any new drafts were created (not one per draft, to avoid spam)
- **Dashboard audience split:** Stats/admin views stay accessible but shouldn't be the first thing Debi sees
- **No auto-approve:** Debi wants eyes on everything before it sends

---

## Resolved Questions

- **Notification format:** Batched — one message per cron run if any new drafts created (e.g. "3 drafts ready for your review" + link to dashboard). Not one per draft.
- **Draft body in notification:** No — just a link. Keeps Chat clean and avoids surfacing email content there.
- **Google Chat webhook:** Needs to be created. New incoming webhook in a dedicated space (e.g. "Roland's Drafts" or Debi's personal space).
- **Stats visibility:** Hide entirely from Debi's dashboard. Stats remain accessible at `/admin` for developer use.
- **Bulk actions:** Out of scope for now — volume is low enough that one-by-one is fine.
