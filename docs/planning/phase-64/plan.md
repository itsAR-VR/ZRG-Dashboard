# Phase 64 — Fix Booking Link in AI Drafts (Client-Scoped Links)

## Purpose
Fix the bug where AI-generated drafts use an outdated/default booking link instead of the client’s intended booking link configuration, with explicit support for a branded/public Calendly outbound link.

## Context
**Bug Report:** [Jam Recording](https://jam.dev/c/59c23d20-c308-48ec-ba07-722a5b0be62d)

**The Problem:** A lead from a new email campaign receives an AI draft containing:
- The **old booking link** (from the workspace default)
- The **old membership fee** ($791/month)

The lead should receive the client’s intended outbound “send link” (Calendly branded/public override) and the correct campaign instructions. The pricing drift is **not** in scope for this phase (confirmed 2026-01-27: caused by custom instructions, not code).

## Update (2026-01-27)

- Booking link configuration is **client-scoped** (stored on `WorkspaceSettings` keyed by `clientId = Client.id`), not campaign-scoped.
- For Calendly, Link A / Link B semantics are defined in Phase 62:
  - Link A (with qualification questions) is used in outbound messaging.
  - Link B (no questions) is used for direct/API booking when answers are missing.
- Do **not** use `Lead.preferredCalendarLinkId` or campaign assignment as the selector for Link A vs Link B.
- Calendly outbound “send link” should be the **branded/public override link** (not necessarily the raw Calendly event type link).

### Root Cause Analysis

**Current Data Flow (Where Drift Can Happen):**
```
Lead → AI Draft Generation → resolveBookingLink(clientId, settings) → Workspace Default CalendarLink
                                       ↑
                                       └── booking link is client-scoped, but enforcement can still fail downstream
```

**Key Code Locations:**
| File | Line | Issue |
|------|------|-------|
| `lib/ai-drafts.ts` | ~1048-1119 | Lead fetch includes `emailCampaign.aiPersona` but NOT calendar/booking preferences |
| `lib/ai-drafts.ts` | ~2194 | `resolveBookingLink()` called with only `clientId` + `settings` |
| `lib/ai-drafts.ts` | ~2190-2234 | Step 3 verifier + hard post-pass canonicalization only runs for `channel === "email"` |
| `lib/meeting-booking-provider.ts` | 44-69 | `resolveBookingLink()` is client-scoped and already returns Calendly Link A (`calendlyEventTypeLink`) or CalendarLink `publicUrl || url` (non-Calendly) |
| `prisma/schema.prisma` | 936-964 | `EmailCampaign` has `bookingProcessId` but NO `calendarLinkId` |

**What Exists Today:**
- `Lead.preferredCalendarLinkId` — Per-lead calendar override (used by Action Station + availability; not used for Link A/B selection)
- `EmailCampaign.bookingProcessId` — Campaign booking process (for instructions, not calendar selection)
- `CalendarLink.isDefault` — Workspace default calendar
- `WorkspaceSettings.calendlyEventTypeLink` — Calendly-specific workspace default
- `WorkspaceSettings.calendlyDirectBookEventTypeLink/Uri` — Calendly direct-book (no questions) event type (Phase 62)
- `WorkspaceSettings.ghlDirectBookCalendarId` — GHL direct-book (no questions) calendar (Phase 62)
- `actions/settings-actions.ts:getCalendarLinks()` — Existing “list calendar links” action (used by Settings UI)
- `actions/settings-actions.ts:getCalendarLinkForLead()` — Lead-preferred > workspace-default resolver (used by Action Station)

**What's Missing:**
- A deterministic guarantee that outbound drafts contain the correct outbound booking link (Link A) when configured (or contain no booking link when missing).
- Regression coverage for booking-link canonicalization so stale links cannot reappear.
- Calendly branded/public override support in the outbound resolver (today Calendly returns the raw event-type link; expected “send link” is the branded/public override).

### Prior Design Idea (Now Obsolete): Campaign → CalendarLink Association

Two options:

**Option A: Add `EmailCampaign.calendarLinkId`** (Recommended)
**Option A: Add `EmailCampaign.calendarLinkId`** (Obsolete)
- Simple, direct relationship
- Campaign explicitly specifies which CalendarLink to use
- Falls back to workspace default if not set
- Consistent with existing `Lead.preferredCalendarLinkId` pattern

**Option B: Derive from `EmailCampaign.bookingProcessId`**
- BookingProcess would need a `calendarLinkId` field
- More indirect, harder to understand
- BookingProcess is about instructions, not calendar selection

**Status:** Obsolete for booking links as of 2026-01-27. Booking links are client-scoped; see Update section above.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 63 | Active | `lib/ai-drafts.ts` (error handling improvements) | Phase 64 modifies draft generation flow; coordinate merges |
| Phase 62 | Complete (uncommitted) | `lib/booking.ts`, `lib/calendly-api.ts`, `prisma/schema.prisma` | Phase 62 defines Calendly Link A/B semantics; Phase 64 must align outbound drafts with Link A |
| Phase 61 | Complete (uncommitted) | `prisma/schema.prisma`, `actions/settings-actions.ts` | Merge Phase 61 schema changes first |

## Pre-Flight Conflict Check (Multi-Agent)

- Start from a clean working tree (or a dedicated branch) before touching shared files like `lib/ai-drafts.ts` and AI runner utilities (`lib/ai/prompt-runner/*`).
- Coordinate/rebase with Phase 62 (dual-link booking) and Phase 61 (availability cron/cache) because this bug spans booking-link + availability behavior.
- Files this phase is expected to touch (client-scoped booking links; no campaign calendar assignment):
  - `lib/ai-drafts.ts` — Ensure outbound drafts always use Link A and enforce canonical booking link behavior when Link A is unset
  - `lib/booking-process-instructions.ts` — Ensure booking link insertion uses Link A for outbound messaging
  - `lib/meeting-booking-provider.ts` — Ensure `resolveBookingLink()` remains the single source of truth for outbound booking links (provider-aware)
  - (Optional, if needed for consistency) `lib/followup-engine.ts`, `lib/lead-scheduler-link.ts` — align other booking-link injection points

## Objectives
* [ ] Ensure AI drafts always use the client’s intended outbound booking link (Link A)
* [ ] Ensure booking-process instructions use the same outbound booking link source as AI drafts
* [ ] Ensure “no booking link configured” results in drafts that do **not** contain stale/hallucinated booking links
* [ ] For Calendly, ensure outbound “send link” uses the **branded/public override link**

## Constraints
- **No breaking changes:** `resolveBookingLink()` remains available for existing call sites
- **Minimal footprint:** Only modify files necessary for the fix
- **Provider agnostic:** Must work for both GHL (CalendarLink.publicUrl fallback) and Calendly (WorkspaceSettings Link A/B semantics)

## Non-Goals
- Changing availability fetching/caching behavior (`CalendarLink.url` remains the availability source-of-truth).
- Reworking booking process semantics (this phase only changes booking link resolution).
- Fixing pricing/copy drift (confirmed 2026-01-27: caused by custom instructions, not code).

## Success Criteria
- [ ] Outbound messages (AI drafts / booking-process instructions) always include the **“send link”** (Link A / with questions) for Calendly workspaces when configured
- [ ] When Link A is unset/missing, outbound drafts do not contain booking links (prevent stale/hallucinated links)
- [ ] Booking process instructions (Phase 36) use the same outbound booking link as AI drafts
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] If this phase changes `prisma/schema.prisma`: `npm run db:push` completes successfully

## Subphase Index
* a — Root cause: reproduce + confirm config expectations
* b — Outbound booking link resolution: Calendly branded/public override + null-handling
* c — AI drafts integration: enforce canonical outbound link + prevent stale links
* d — Scope confirmation: custom instructions (pricing) out-of-scope + outbound call sites
* e — Validation: scenarios + lint/build
* f — Hardening: unit coverage + rollout notes

## Repo Reality Check (RED TEAM)

### What exists today
- `lib/meeting-booking-provider.ts`:
  - `resolveBookingLink(clientId, settings)` — Returns client-scoped outbound booking link (Calendly: `calendlyEventTypeLink`; non-Calendly: default `CalendarLink.publicUrl || url`)
  - `getBookingLink(clientId, settings)` — Wrapper around resolveBookingLink
- `lib/ai-drafts.ts`:
  - `generateAiDraft()` — Main entry point
  - Line ~1048: Lead fetch includes `emailCampaign.aiPersona` but not booking preferences
  - Line ~2194: Calls `resolveBookingLink()` without campaign context
- `prisma/schema.prisma`:
  - `Lead` has `preferredCalendarLinkId` (per-lead override)
  - `CalendarLink` has `isDefault` flag and `publicUrl` field
  - `WorkspaceSettings` stores Calendly Link A/B: `calendlyEventTypeLink` and `calendlyDirectBookEventTypeLink` (Phase 62)
- `lib/booking-process-instructions.ts`:
  - `getBookingProcessInstructions()` fetches lead with campaign info
  - Calls `getBookingLink()` — booking-link source must align with AI drafts
- `lib/followup-engine.ts` + `lib/lead-scheduler-link.ts`:
  - Call `getBookingLink()` today (these are other outbound injection points)
- `actions/settings-actions.ts`:
  - `getCalendarLinks(clientId)` exists and returns `CalendarLink` data for Settings UI
  - `getCalendarLinkForLead(leadId)` already implements lead-preferred > workspace-default (publicUrl fallback)

### What this plan assumes
- Booking link config is client-scoped (WorkspaceSettings / CalendarLink.publicUrl).
- Calendly outbound messaging uses Link A; direct booking uses Link B when answers are missing (Phase 62).
- This phase does not add campaign-specific calendar assignment.

### Verified touch points
- `lib/meeting-booking-provider.ts`: `resolveBookingLink()`, `getBookingLink()`
- `lib/ai-drafts.ts`: booking link resolution (~2194) + Step 3 enforcement path
- `lib/ai-drafts/step3-verifier.ts`: `enforceCanonicalBookingLink()`
- `lib/booking-process-instructions.ts`: booking link insertion via `getBookingLink()`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Lead preference semantics:** `preferredCalendarLinkId` already affects some flows (Action Station + availability). Product intent for booking-link selection is now **Link A vs Link B**, not “preferred calendar link” selection — avoid conflating the two.
- **Booking process instructions:** `lib/booking-process-instructions.ts` also calls `getBookingLink()` — must use the same outbound booking-link resolution as AI drafts to avoid internal prompt inconsistency.
- **Link A unset:** If Calendly Link A is missing, AI drafts may include stale/hallucinated booking links unless we explicitly strip/guard.
- **Availability mismatch:** Suggested times in AI drafts come from availability cache which may not match the booking target; Phase 62j is responsible for dual-source availability.
- **Calendly branded/public override not applied:** Calendly outbound “send link” must come from a branded/public override, but current Calendly resolver returns only `WorkspaceSettings.calendlyEventTypeLink`.

### Repo mismatches (fix the plan)
- `actions/campaign-actions.ts` is for GHL workflow campaigns; email campaign settings live in `actions/email-campaign-actions.ts`.
- “List calendar links” already exists: `actions/settings-actions.ts:getCalendarLinks()`. Reuse it or create a dedicated `actions/calendar-link-actions.ts`, but don’t accidentally duplicate behavior.

### Performance / timeouts
- Booking link resolution should remain bounded (at most one default `CalendarLink` lookup when non-Calendly).

### Security / permissions
- Booking link settings changes must remain admin-gated (Settings UI/server actions already enforce this).

### Rollback / fallback
- Fast rollback path: set Calendly Link A/B values back to prior values in `WorkspaceSettings`.
- Code-level fallback: if Link A is missing, omit booking links from outbound drafts (do not allow stale links).

### Missing requirements
- Scope clarity: `getBookingLink()` is used by **AI drafts**, **booking-process instructions**, **follow-ups**, and **scheduler-link generation** today. Decide whether this phase should intentionally change all of those outbound paths, or introduce a dedicated “outbound send-link” resolver to keep scope tight.

### Testing / validation
- Test: Calendly workspace with Link A set → outbound draft includes Link A
- Test: Calendly workspace without Link A set → outbound draft includes **no** booking link
- Add unit coverage so booking-link injection cannot regress to stale links.

## Open Questions (Need Human Input)
- [x] For Calendly workspaces, how should booking links be configured: per-campaign or per-client?
  - **Resolved (2026-01-27):** Per client (WorkspaceSettings), not per campaign and not “white-label workspace” scoped.
- [x] Should `Lead.preferredCalendarLinkId` override campaign assignment for outbound booking links (AI drafts + booking process instructions)?
  - **Resolved (2026-01-27):** No. A/B booking link selection is handled by a booking-target selection step (Link A vs Link B). We should not use “preferred calendar link” as a selector for which booking link/event type to use.
- [ ] Should the outbound booking-link fix apply only to AI drafts + booking process instructions, or also to follow-ups/other outbound messages?
  - Why it matters: users may expect consistent behavior across all booking-link injection points.
  - Current assumption in this plan: **unknown** (need decision); safest is to apply to all outbound call sites that use `getBookingLink()` so messaging stays consistent.
- [x] For Calendly workspaces, should the outbound “send link” be the raw Calendly event type link (`WorkspaceSettings.calendlyEventTypeLink`) or a branded/public override link (e.g., `CalendarLink.publicUrl` or a new dedicated field)?
  - Why it matters: the Jam bug may be an “expectation mismatch” if the desired outbound link is a branded URL but Calendly workspaces currently only support raw event-type links.
  - **Resolved (2026-01-27):** Branded/public override link.

## Assumptions (Agent)
- Booking links are client-scoped (WorkspaceSettings + CalendarLink.publicUrl fallback), not campaign-scoped (confidence ~95%)
- `CalendarLink.publicUrl` is the public booking link override for non-Calendly providers and should be used for outbound booking links (confidence ~95%)
- For Calendly workspaces, outbound “send link” is the questions-enabled booking target (Link A) but represented as a branded/public override link; direct booking uses Link A only when answers are complete; otherwise Link B (Phase 62 semantics) (confidence ~90%)
  - Mitigation: If campaign-specific links are later required, add explicit per-campaign fields for A/B (do not overload `preferredCalendarLinkId`).
