# Phase 143d — Draft Generation Context Injection

## Focus

Extend `DraftGenerationOptions` in `lib/ai-drafts.ts` to accept `actionSignals` and inject signal-aware instructions into AI draft prompts. **Note:** this file has uncommitted Phase 140 changes — re-read current state before editing.

## Inputs

- `ActionSignalDetectionResult` type from Phase 143a
- Pipeline pass-through from 143b + 143c

## Work

### 1. Extend `DraftGenerationOptions` (after `autoBookingContext`)

```typescript
import type { ActionSignalDetectionResult } from "@/lib/action-signal-detector";

actionSignals?: ActionSignalDetectionResult | null;
```

### 2. Create `buildActionSignalsPromptAppendix(result)` helper

Returns empty string if no signals. Otherwise:

For `call_requested`:
```
ACTION SIGNALS DETECTED:
- The lead has requested or implied they want a phone call.
- Acknowledge this. Offer to set up a call or confirm someone will reach out by phone.
- Do NOT suggest email-only scheduling when a call was explicitly requested.
```

For `book_on_external_calendar`:
```
ACTION SIGNALS DETECTED:
- The lead wants to book on someone else's calendar or provided their own scheduling link.
- Do NOT offer the workspace's default availability/booking link.
- Acknowledge their calendar/link and coordinate through it.
```

Both → concatenate both blocks.

### 3. Inject into 3 prompt construction paths

Same pattern as `autoBookingSchedulingAppendix`:
1. Email Step 1 strategy instructions
2. Email Step 2 fallback system prompt
3. SMS/LinkedIn instructions

### 4. Inject into meeting overseer gate memory context

After existing `autoBookingContext` block, append signal summary so gate doesn't override.

### 5. Build appendix early in `generateResponseDraft`

After resolving `autoBookingSchedulingAppendix`:
```typescript
const actionSignalsPromptAppendix = opts.actionSignals?.signals.length
  ? buildActionSignalsPromptAppendix(opts.actionSignals)
  : "";
```

## Progress This Turn (Terminus Maximus)
- Work done:
  - Replaced temporary `actionSignals?: unknown` with typed `actionSignals?: ActionSignalDetectionResult | null` in `DraftGenerationOptions`.
  - Added `buildActionSignalsPromptAppendix(...)` helper and meeting-overseer `buildActionSignalsGateSummary(...)`.
  - Injected action-signal appendix into email strategy instructions, email fallback prompt, and SMS/LinkedIn instructions.
  - Appended action-signal summary to meeting-overseer gate memory context so call/external-calendar intent survives gating.
- Commands run:
  - `rg --line-number "actionSignals|buildActionSignalsPromptAppendix|ACTION SIGNAL CONTEXT" lib/ai-drafts.ts` — pass.
- Blockers:
  - None.
- Next concrete steps:
  - Validate new helper behavior and detector flow in subphase 143e tests.
  - Run lint/build gates.

## Output

- `DraftGenerationOptions` now accepts typed `ActionSignalDetectionResult` payloads from all inbound pipelines.
- Action-signal guidance is injected into all prompt paths that previously used auto-booking appendices.
- Meeting overseer gate now receives explicit action-signal context (`call_requested`, `book_on_external_calendar`, evidence summary).
- Coordination notes:
  - Changes were merged into `lib/ai-drafts.ts` while concurrent phase 139/140 edits were present; edits remained localized to options typing + prompt/memory appendices.

## Handoff

Production wiring is complete; proceed to 143e for regression tests and verification command evidence.
