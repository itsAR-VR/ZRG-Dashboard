# Phase 52b — Outbound: Link-First + Qualification; “Initial Email Times” Persistence

## Focus
Ensure outbound behavior can express the required booking processes, and decide how we persist “times we sent” so inbound acceptance can auto-book reliably.

## Inputs
- Phase 52a flow spec and clarifications.
- Booking-process stage primitives (Phase 36): booking link, suggested times, qualifying questions, timezone ask.
- Current offered-slot persistence paths in `lib/ai-drafts.ts` and `lib/followup-engine.ts`.

## Work
- Process (1): “Send link + qualification question(s), no times”
  - Confirm stage configuration supports: `includeBookingLink=true`, `includeSuggestedTimes=false`, `includeQualifyingQuestions=true`.
  - Decide whether to add a first-class template in `lib/booking-process-templates.ts` for this process (so it’s selectable without manual setup).
  - Confirm where “Interested” fits: ensure drafts generated for “Interested” can be governed by booking process instructions (vs only meeting-requested).
- Process (2): “We already sent times in the initial email; inbound chooses one → auto-book”
  - Clarified requirement: this is the **very first outbound email sent by the campaign provider (EmailBison)** where we inject two times via a **lead custom variable** named **exactly** `availability_slot`.
  - Define an in-app replacement for the n8n workflow:
    - Determine the scheduled send datetime for the first outbound (EmailBison `GET /api/leads/:id/scheduled-emails`).
    - Only operate when the first outbound is scheduled within the next 24 hours, and generate/update the variable ~15 minutes before scheduled send (just-in-time).
    - Fetch workspace availability (UTC slots) and choose 2 slots **after** the scheduled send time, preferring the next ~5 business days and minimizing overlap via our `WorkspaceOfferedSlot` ledger (not Google Sheets).
    - Render a stable availability sentence in the workspace timezone (no LLM required) and **PATCH EmailBison lead custom variables** (missing wrapper today).
    - Persist the chosen 2 slots to `Lead.offeredSlots` (and increment `WorkspaceOfferedSlot` counts) so inbound “Tuesday 3pm works” can auto-book reliably.
  - Identify/implement the required EmailBison endpoints we do not yet wrap:
    - `GET /api/leads/:id/scheduled-emails` (to get `scheduled_date_local`)
    - `PATCH /api/leads/:id` (to set `custom_variables[]`)
  - Define idempotency rules:
    - Once we’ve set first-touch offered slots for a lead + scheduled email, do not rotate unless the scheduled send date changes.
    - Never overwrite `Lead.offeredSlots` if the lead already has a booked appointment or if newer offered slots exist from later stages.

## Output
- A concrete implementation decision for “initial email times” (campaign-provider + EmailBison custom-variable injection), with required touchpoints listed.
- A proposed booking-process template definition for (1), if we choose to ship it.

## Handoff
Proceed to Phase 52c with a decided persistence strategy so inbound auto-booking can safely assume when `Lead.offeredSlots` is authoritative.

## Output (Completed)

### Process (1): Link-first + qualification questions (no times)

- Added a first-class booking process template: **“Link + Qualification (No Times)”** (`lib/booking-process-templates.ts`).
- Updated booking process instruction builder to support **questions-first vs link-first vs times-first** ordering per stage.

### Stage-level ordering (configurable in Booking Processes)

- Added stage field `BookingProcessStage.instructionOrder` (nullable enum) in `prisma/schema.prisma`.
- Updated `lib/booking-process-instructions.ts` to:
  - honor `instructionOrder` when combining **questions / times / link**
  - default ordering when unset:
    - if stage includes times → **TIMES_FIRST**
    - otherwise → **QUESTIONS_FIRST**
- Updated Booking Process Manager UI to let users set `Instruction Order` per stage (`components/dashboard/settings/booking-process-manager.tsx`).

### Templates: bulk creation + defaults

- Added 5 stakeholder-aligned templates to `lib/booking-process-templates.ts`:
  - Link + Qualification (No Times)
  - Initial Email Times (EmailBison availability_slot)
  - Lead Proposes Times (Auto-Book When Clear)
  - Call Requested (Create Call Task)
  - Lead Provided Calendar Link (Escalate or Schedule)
- Added a bulk template-create action: `createBookingProcessesFromTemplates()` (`actions/booking-process-actions.ts`).
- Updated Templates dialog to support:
  - multi-select templates
  - **Select defaults**
  - **Create selected (N)** directly in the workspace DB (`components/dashboard/settings/booking-process-manager.tsx`).

### Process (2) note (no overlap)

- Confirmed “initial EmailBison email includes `availability_slot`” is implemented under **Phase 55** (`lib/emailbison-first-touch-availability.ts`, `app/api/cron/emailbison/availability-slot/route.ts`), so Phase 52 does not re-implement it.

## Handoff

- Proceed to **Phase 52c** to extend inbound automation for:
  - auto-booking on offered slots (ensure compatibility with Phase 55’s `Lead.offeredSlots`)
  - lead-proposed-time parsing + high-confidence auto-booking + escalation task on ambiguity
