# Phase 93c — Auto-Start Routing Logic (ALL Trigger Types)

## Focus
Generalize ALL auto-start functions to select the correct workflow based on campaign persona:
* Aaron-persona campaigns → Aaron workflow
* Chris-persona campaigns → Chris workflow
* Fallback to legacy name-based behavior when no persona-routed workflows exist

**Scope:** All 3 auto-start functions:
1. `autoStartMeetingRequestedSequenceOnSetterEmailReply` — `setter_reply`
2. `autoStartNoResponseSequenceOnOutbound` — `no_response`
3. `autoStartPostBookingSequenceIfEligible` — `meeting_selected`

## Inputs
* Phase 93a: `FollowUpSequence.aiPersonaId`
* Existing triggers in `lib/followup-automation.ts`
* Persona assignment: `EmailCampaign.aiPersonaId` (campaign assignment panel)

## Work

### 1. Create shared routing helper

Create `lib/followup-sequence-router.ts`:

```typescript
/**
 * Generic persona-aware sequence router.
 * Used by all auto-start functions to select the correct workflow.
 */
export async function routeSequenceByPersona(opts: {
  clientId: string;
  triggerOn: "setter_reply" | "no_response" | "meeting_selected";
  campaignAiPersonaId: string | null;
  legacySequenceNames?: string[];  // Fallback for backward compat
}): Promise<{ id: string; name: string; aiPersonaId: string | null } | null>
```

Selection rules:
1. Query active sequences where `clientId`, `isActive = true`, `triggerOn` matches
2. Prefer `sequence.aiPersonaId === campaignAiPersonaId` (exact match)
3. Else prefer `sequence.aiPersonaId IS NULL` (generic)
4. Tie-breaker: newest `createdAt DESC`
5. If zero matches, fall back to legacy name-based selection

### 2. Refactor `autoStartMeetingRequestedSequenceOnSetterEmailReply`

File: `lib/followup-automation.ts:366-485`

a. Update lead query to include:
   ```typescript
   emailCampaign: { select: { id: true, aiPersonaId: true } }
   ```

b. Replace sequence selection with:
   ```typescript
   const sequence = await routeSequenceByPersona({
     clientId: lead.clientId,
     triggerOn: "setter_reply",
     campaignAiPersonaId: lead.emailCampaign?.aiPersonaId ?? null,
     legacySequenceNames: [...MEETING_REQUESTED_SEQUENCE_NAMES],
   });
   ```

c. Preserve all 6 existing gates (lines 384-449) — NO CHANGES

### 3. Refactor `autoStartNoResponseSequenceOnOutbound`

File: `lib/followup-automation.ts:346-363`

a. Update lead query to include `emailCampaign`
b. Replace sequence selection with router call (`triggerOn: "no_response"`)
c. Preserve existing `handleOutboundTouchForFollowUps` behavior

### 4. Refactor `autoStartPostBookingSequenceIfEligible`

File: `lib/followup-automation.ts:145-185`

a. Update lead query to include `emailCampaign`
b. Replace sequence selection with router call (`triggerOn: "meeting_selected"`)

### 5. Add structured logging

For each function, log:
```typescript
console.log("[FollowUp] Auto-start routing", {
  triggerOn,
  leadId: lead.id,
  clientId: lead.clientId,
  emailCampaignId: lead.emailCampaign?.id ?? null,
  routingPersonaId: lead.emailCampaign?.aiPersonaId ?? null,
  sequenceId: sequence?.id ?? null,
  sequenceName: sequence?.name ?? null,
});
```

## Validation (RED TEAM)

- [ ] All 3 auto-start functions use `routeSequenceByPersona`
- [ ] Lead queries include `emailCampaign.aiPersonaId`
- [ ] Legacy fallback works when no persona-specific sequences exist
- [ ] Existing gates preserved (no behavior regression)
- [ ] `@@unique([leadId, sequenceId])` still prevents duplicates

## Output
* Added `lib/followup-sequence-router.ts` with `routeSequenceByPersona(...)` for trigger + persona selection (with name-based fallback).
* Updated `lib/followup-automation.ts`:
  - `autoStartMeetingRequestedSequenceOnSetterEmailReply(...)` uses routing helper for `triggerOn="setter_reply"` and logs routing details.
  - `autoStartPostBookingSequenceIfEligible(...)` uses routing helper for `triggerOn="meeting_selected"` and logs routing details.
  - Legacy fallback preserved (ZRG Workflow V1 → legacy name; Post-Booking fallback).
* **Note:** `autoStartNoResponseSequenceOnOutbound(...)` remains deprecated (Phase 66) and still does not auto-start sequences, so no routing applied there.

## Handoff
Phase 93d can expose configuration UI so admins can create persona-bound workflows for any trigger type.

## Coordination Notes

**Unrelated working tree changes detected:** `lib/availability-cache.ts`, `scripts/backfill-ai-auto-send.ts`, `lib/draft-availability-refresh.ts` (left untouched).
