# Booking Process 5 — Lead-Provided Scheduler Link

## Goal
When a lead replies with their **own** scheduler link (Calendly, Cal.com, GoHighLevel booking links, HubSpot Meetings, etc.), the system should help us get the meeting booked without creating double-bookings or unsafe automation.

## Current behavior (Phase 52)

### 1) Capture the link
- Inbound processors attempt to detect scheduler links in message text.
- The most recently seen link is stored on the lead:
  - `Lead.externalSchedulingLink`
  - `Lead.externalSchedulingLinkLastSeenAt`

### 2) When to “act”
- We **always capture** the link when detected.
- We only “act” when intent indicates “please book via my link” (e.g., sentiment resolves to **Meeting Booked** for this guardrail case).

### 3) Manual review + overlap suggestion (shipping now)
- We do **not** auto-book on third-party schedulers in Phase 52.
- Instead we create a **deduped** follow-up task (`campaignName="lead_scheduler_link"`) containing:
  - The lead’s scheduler link
  - A suggested overlap time (if we can intersect lead-availability + workspace-availability)
  - A fallback recommendation to ask them to use our scheduling link if needed

This is the “flag it for review” path.

## Why manual for now
- Many scheduler platforms don’t provide a stable “book as invitee” API using only a public link.
- Some providers require OAuth or org-level installs, which are not configured per client today.
- Browser automation in serverless environments is unreliable due to timeouts and headless constraints.

## Future automation (planned)

### Option A — Provider APIs (preferred where available)
Implement provider-specific booking calls when the provider has a supported public or workspace-authorized booking API.

### Option B — Browser automation (Playwright) for long-tail platforms
For platforms without clean APIs (or where clients don’t want OAuth), use Playwright to book via the scheduler UI.

Recommended shape:
- Long-running worker (Fly.io) to avoid serverless timeouts
- Triggered by background jobs (idempotent; retries safe)
- Evidence + safety:
  - validate the target slot before booking
  - store a booking “evidence record” (at minimum: provider name, link, chosen slot, timestamp; optionally screenshot)
  - hard guardrails to prevent double-booking and to require clear lead intent

## UI notices / flags
- The Booking tab should surface a “Notices” menu warning that Process 5 is manual-review right now.
- When automation is added, ship behind an explicit warning/notice flag in the Booking tab.

