# Phase 79a — Draft Generation Awareness

## Focus

Make AI draft generation aware of lead-provided scheduling links. When `Lead.externalSchedulingLink` exists, modify prompts to:
1. Skip offering workspace availability slots
2. Acknowledge the lead's scheduler link instead

## Inputs

- Phase 76: `lib/email-signature-context.ts` signature extraction (already surfaces links)
- `Lead.externalSchedulingLink` field from schema (Phase 52d)
- `lib/ai-drafts.ts` draft generation pipeline

## Work

### 1. Add `externalSchedulingLink` to Lead Query

**Location:** `lib/ai-drafts.ts` — lead query in `generateResponseDraft()`

Add to the `select` clause:
```typescript
externalSchedulingLink: true,
```

### 2. Check for Lead Scheduler Link

**Location:** After signature context extraction (~line 1481)

```typescript
const leadHasSchedulerLink = Boolean(lead.externalSchedulingLink?.trim());
const leadSchedulerLink = leadHasSchedulerLink ? lead.externalSchedulingLink!.trim() : null;
```

### 3. Modify Strategy Instructions

**Location:** `buildEmailDraftStrategyInstructions()` (~line 860)

Add new parameter `leadSchedulerLink: string | null`

When `leadSchedulerLink` is present, inject:
```
LEAD-PROVIDED SCHEDULING LINK:
The lead has shared their own scheduling link: {leadSchedulerLink}
IMPORTANT: Do NOT offer our availability times. Instead, acknowledge their link and express willingness to book via their scheduler.
```

### 4. Update `should_offer_times` Prompt Guidance

**Location:** Strategy task description (~line 947)

Add to the timing awareness guidance:
```
LEAD SCHEDULER: If a lead-provided scheduling link is present, set should_offer_times to false and plan to acknowledge their link.
```

### 5. Skip Availability When Lead Has Link

**Location:** Where availability is passed to strategy instructions (~line 1516)

When `leadHasSchedulerLink`, either:
- Pass empty availability array, OR
- Add note: "Lead has provided their own scheduling link — availability slots not applicable"

## Output

- Updated `lib/ai-drafts.ts` lead query to include `externalSchedulingLink`.
- Derived `leadSchedulerLink` / `leadHasSchedulerLink` and prevented workspace slot offering when the lead provided their own scheduling link.
- Added prompt guidance (strategy + generation + fallback + SMS/LinkedIn) to:
  - set `should_offer_times=false` when a lead scheduler link is present
  - acknowledge the lead's link and avoid offering our booking link / availability times.
- Lint/build deferred to Phase 79 wrap-up (to run once after 79b).

## Coordination Notes

**Overlap:** `lib/ai-drafts.ts` is also touched by Phase 80 ("Meeting Booked" draft fix).  
**Resolution:** Merged changes by keeping Phase 80 behavior and layering Phase 79 scheduler-link instructions on top.

## Handoff

Proceed to Phase 79b to expand manual task creation trigger.
