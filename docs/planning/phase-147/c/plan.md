# Phase 147c - SMS Unstick Fix (Missing/Invalid Phone Skip-and-Advance)

## Focus
Normalize SMS blocked-phone handling so missing/invalid phone conditions do not stall sequence execution.

## Inputs
- Phase 147a runtime contract
- LinkedIn pattern changes from Phase 147b
- SMS handling code in `lib/followup-engine.ts` and related phone/GHL helpers

## Work

### 1. Existing SMS skip-and-advance (DO NOT reimplement)

**Already working** at `lib/followup-engine.ts:1954-1977`:
- Matches `"missing phone"`, `"phone missing"`, `"no usable phone"`, `"no phone"` in error messages.
- Creates `FollowUpTask` with `suggestedMessage: "SMS skipped — {msg}"`.
- Returns `action: "skipped"`, `advance: true`.

Also existing pre-execution skips:
- Line 1115-1121: Condition `phone_provided` skip + advance.
- Line 1131-1145: Missing phone after enrichment terminal + advance.
- Backstop at line 2740-2752: Missing phone after enrichment terminal + advance.

**These are correct and must not be changed.**

### 2. Add `invalid_country_code` handling (NEW — RED TEAM F2)

GHL returns `errorCode: "invalid_country_code"` (`lib/ghl-api.ts:98-99`) for phone numbers with bad country prefixes. Currently this falls through to the generic `blocked_sms_error` pause at lines 2005-2012 — permanent starvation.

**Add to the error dispatch at ~line 1955** (alongside the existing missing-phone check):

```typescript
// Existing check (lines 1955-1959):
if (
  lower.includes("missing phone") ||
  lower.includes("phone missing") ||
  lower.includes("no usable phone") ||
  lower.includes("no phone") ||
  lower.includes("invalid country calling code")  // <-- ADD THIS
) {
  // existing skip-and-advance logic at lines 1961-1976
}
```

This follows the established pattern exactly — one keyword addition to the existing guard.

### 3. Preserve successful SMS send paths and existing retry logic

- DND retry loop (lines 1882-1936, 24 hourly attempts): unchanged — temporary, self-resolving.
- GHL config errors (`blocked_sms_config`, lines 1979-2002): unchanged — admin-recoverable.
- Successful SMS sends: unchanged.

### 4. Enforce catch-up semantics

- No replay of skipped historical SMS steps when phone appears later.
- Continue with next eligible SMS step only.
- This is already the natural behavior of `advance: true` — it increments `currentStep` past the skipped step permanently.

## Output
SMS runtime behavior that avoids infinite blocked retries and keeps sequence progression deterministic.

## Handoff
Phase 147d adds/updates regression tests and runs mandatory validation gates for AI/message pipelines.
