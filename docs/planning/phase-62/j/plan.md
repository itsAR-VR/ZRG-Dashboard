# Phase 62j — Availability + AI Selector: Dual Availability Sources + Booking Target Selection (A vs B)

## Focus
Make dual-link direct booking fully robust by:

1) adding an AI step that explicitly selects **Link A (with questions)** vs **Link B (no questions)** at booking time, and  
2) ensuring availability/offered slots come from the **same target** we will book on (avoid “offer from A, book on B” drift).

This subphase explicitly reflects the 2026-01-27 clarified product intent:
- Outbound messages always include **Link A**.
- Direct/API booking uses **A** only when answers are complete; otherwise uses **B**.
- `Lead.preferredCalendarLinkId` is not the mechanism for selecting A vs B.
- Scope: all configuration is **client-scoped** (stored on `WorkspaceSettings` keyed by `clientId = Client.id`), not “white-label workspace” scoped.

## Inputs
- Phase 62b–62d shipped artifacts:
  - `lib/qualification-answer-extraction.ts` + `ensureLeadQualificationAnswersExtracted()` readiness state
  - `lib/booking.ts:bookMeetingOnCalendly()` routing between `calendlyEventTypeUri` (A) and `calendlyDirectBookEventTypeUri` (B)
  - `WorkspaceSettings.calendlyEventTypeLink/Uri` (A) and `WorkspaceSettings.calendlyDirectBookEventTypeLink/Uri` (B)
  - GHL equivalents: `WorkspaceSettings.ghlDefaultCalendarId` (A booking) and `WorkspaceSettings.ghlDirectBookCalendarId` (B booking)
- Availability system (Phase 61):
  - `lib/availability-cache.ts` + `/api/cron/availability` currently refresh one cache per workspace keyed by default CalendarLink
  - Known mismatch warnings in Settings indicate availability can drift from booking targets
- AI implementation guidance (Context7):
  - OpenAI Node SDK supports Responses API via `client.responses.create(...)` (and `client.responses.parse(...)` helpers)
  - Structured outputs can be enforced via JSON Schema / strict formats; prefer the repo’s existing `runStructuredJsonPrompt()` (Responses API + `text.format: { type: "json_schema", strict: true }`)
  - Handle incomplete/truncation explicitly (e.g. `response.status === "incomplete"` with `incomplete_details.reason === "max_output_tokens"`) using retries/fallbacks
  - Timeouts are configured as integer milliseconds (global client option or per-request `timeout`); avoid passing `timeout: undefined` because the SDK validates the field when present

## Work

### 1) Add a booking-target selector AI step (A vs B)

**Goal:** At the moment we are about to direct-book, run a low-cost AI step that outputs:

```ts
type BookingTarget = "with_questions" | "no_questions";
```

**Inputs to the model (no PII):**
- Workspace qualification question list (ids + text + required bool)
- Extracted answer state summary (which required IDs have answers)
- Recent sanitized conversation transcript (last N messages; redact emails/phones if present)
- Provider context: `meetingBookingProvider`, whether A/B are configured

**Prompt behavior (must be deterministic-ish):**
- If required answers are complete → prefer `"with_questions"`
- Otherwise → `"no_questions"`

**Safety gates (non-negotiable):**
- Even if the model chooses `"with_questions"`, only attempt A if we can construct a valid payload:
  - all required answers present, and
  - Calendly custom question `position` mapping is complete
- Otherwise force fallback to `"no_questions"`
- If AI call fails or returns incomplete output → default to `"no_questions"`

**Implementation location (recommended):**
- Create `lib/booking-target-selector.ts` exporting:
  - `selectBookingTargetForLead(args): Promise<{ target: BookingTarget; source: "ai" | "deterministic_fallback"; reason?: string }>`
- Use existing prompt runner utilities in `lib/ai/prompt-runner/*` with strict JSON schema (Responses API).

### 2) Make availability/offered slots target-aware (A vs B)

**Problem today:** availability is cached per workspace default CalendarLink; booking can happen on different targets (Calendly event type URIs / GHL booking calendars), leading to mismatch.

**Target behavior:**
- When generating suggested times / offered slots for a lead:
  - determine the booking target (A/B) up-front using deterministic gates (and optionally the selector AI step)
  - fetch availability from that target’s availability source
  - persist offered slots with metadata indicating which target they came from
- When booking from an offered slot:
  - re-check we are booking with the same target used to generate the slot, or re-validate slot existence on the chosen target

**DB shape (LOCKED):** evolve the availability cache to support multiple sources per client (A + B) without relying on CalendarLink sameness.

- Add Prisma enum:
  - `AvailabilitySource = DEFAULT | DIRECT_BOOK`
- Update `WorkspaceAvailabilityCache` to allow two rows per client:
  - Add `availabilitySource AvailabilitySource @default(DEFAULT)`
  - Replace `clientId @unique` with `@@unique([clientId, availabilitySource])`
  - Update `Client` relation from `availabilityCache` (1:1) → `availabilityCaches` (1:n)
- Update `WorkspaceOfferedSlot` to keep distribution counts per source:
  - Add `availabilitySource AvailabilitySource @default(DEFAULT)`
  - Replace `@@unique([clientId, slotUtc])` with `@@unique([clientId, availabilitySource, slotUtc])`
- Keep `Lead.offeredSlots` as JSON text (no schema change), but include the source used:
  - store each slot as `{ datetime, label, offeredAt, availabilitySource: "DEFAULT" | "DIRECT_BOOK" }`
  - backward-compat: if missing, treat as `availabilitySource="DEFAULT"` when generating follow-ups, and treat as “unknown” when booking (re-validate slot existence).
- Operational rule:
  - Availability fetching uses **provider URLs** (e.g. `calendly.com`, GHL booking widget URLs), not branded/public send links, because provider detection/parsing is URL-pattern based.
  - If `DIRECT_BOOK` is not configured (or identical to `DEFAULT`), treat `DIRECT_BOOK` availability as `DEFAULT` to avoid double provider load.

**Where to wire:**
- `lib/availability-cache.ts`:
  - add `getWorkspaceAvailabilityCache(clientId, { availabilitySource })`
  - add `refreshWorkspaceAvailabilityCache(clientId, { availabilitySource })`
  - for Calendly source A/B:
    - use `WorkspaceSettings.calendlyEventTypeLink/Uri` for `DEFAULT` (A)
    - use `WorkspaceSettings.calendlyDirectBookEventTypeLink/Uri` for `DIRECT_BOOK` (B)
  - for GHL source A/B:
    - use existing default CalendarLink.url for both sources
    - use `WorkspaceSettings.ghlDefaultCalendarId` as calendarIdHint for `DEFAULT`
    - use `WorkspaceSettings.ghlDirectBookCalendarId` as calendarIdHint for `DIRECT_BOOK`
- `/api/cron/availability`:
  - refresh `DEFAULT` for all eligible clients
  - refresh `DIRECT_BOOK` only when configured and distinct:
    - Calendly: `calendlyDirectBookEventTypeLink` set and different from `calendlyEventTypeLink`
    - GHL: `ghlDirectBookCalendarId` set and different from `ghlDefaultCalendarId`
  - report per-source health counts

### 3) Persist which target was used for offered slots

Add a small piece of metadata to avoid mismatches:
- E.g. store `offeredSlots` as JSON objects: `{ slotUtc, target: "with_questions"|"no_questions" }`
- Or add a separate nullable field `Lead.offeredSlotsTarget` when using legacy string array format

Keep backward compatibility: existing `offeredSlots` string array should be treated as “unknown target” and default to B when booking.

## Validation (RED TEAM)
- Unit tests:
  - Booking target selector returns valid JSON and defaults to B on failures/incomplete outputs
  - Availability cache returns distinct results for A vs B (mocked provider)
  - Offered-slot booking rejects/repairs mismatched target
- Manual smoke:
  - Lead w/ all required answers → offers times from A and books via A
  - Lead w/ no answers → offers times from B and books via B
  - Force mismatch (A slots, B booking) → verify we detect and either revalidate or fail safely

## Output
- **DB shape locked (schema + code):**
  - `prisma/schema.prisma`: added `AvailabilitySource` enum and added `availabilitySource` to:
    - `WorkspaceAvailabilityCache` (`@@unique([clientId, availabilitySource])`)
    - `WorkspaceOfferedSlot` (`@@unique([clientId, availabilitySource, slotUtc])`)
  - `Client.availabilityCaches` changed to 1:n (supports `DEFAULT` + `DIRECT_BOOK` caches).
- **Dual availability caches (A/B):**
  - `lib/availability-cache.ts`: added `{ availabilitySource }` routing for cache read/refresh and provider URL selection for Calendly (A = `calendlyEventTypeLink`, B = `calendlyDirectBookEventTypeLink`) and GHL (calendarId hints).
  - `app/api/cron/availability/route.ts`: refreshes both `DEFAULT` and `DIRECT_BOOK` with a split time budget.
- **Offer distribution is source-aware:**
  - `lib/slot-offer-ledger.ts`: counts + increments scoped by `availabilitySource`.
- **Offered slots carry source (mismatch-safe booking):**
  - `lib/ai-drafts.ts`, `lib/followup-engine.ts`, `lib/emailbison-first-touch-availability.ts`: store `availabilitySource` alongside offered slots and book using the same source when accepting an offered slot.
  - `lib/booking.ts`: booking helpers accept `{ availabilitySource }`; Calendly `DIRECT_BOOK` forces the no-questions target.
- **AI booking target selector (A vs B):**
  - `lib/booking-target-selector.ts`: strict JSON-schema output with deterministic fallbacks; wired into `lib/followup-engine.ts` Scenario 3 (lead-proposed time).
- **Validation (2026-01-28):**
  - `npm test`: ✅ pass (51 tests)
  - `npm run lint`: ✅ pass (warnings only)
  - `npm run build`: ✅ pass
  - DB de-dupe check (pre-constraint): ✅ no duplicates found for:
    - `WorkspaceAvailabilityCache(clientId)`
    - `WorkspaceOfferedSlot(clientId, slotUtc)`
  - `npm run db:push -- --accept-data-loss`: ✅ pass (unique constraints applied)
- **Coordination Notes:**
  - Working tree includes concurrent Phase 66 follow-up refactor changes (unrelated domain) touching shared inbound/webhook files; avoided additional edits beyond the dual-availability work needed for this subphase.

## Handoff
- Run a live smoke test (no PII):
  - Lead with complete required answers → offers from `DEFAULT` and books with questions-enabled target
  - Lead with missing required answers → offers from `DIRECT_BOOK` and books on no-questions target
