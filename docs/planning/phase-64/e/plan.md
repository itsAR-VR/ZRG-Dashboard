# Phase 64e — Validation: Scenarios + Lint/Build

## Focus
Validate that outbound drafts (AI drafts + booking process instructions) always use the correct client-scoped outbound booking link (Link A) and never leak stale links when Link A is missing.

## Inputs
- Phase 64b: outbound booking link semantics (Link A + null behavior)
- Phase 64c: AI draft enforcement changes
 - Phase 64d: confirmed scope decisions

## Work

### Step 1: Quality gates
```bash
npm run lint
npm run build
```

If any schema changes happened as part of adjacent work (not expected for Phase 64):
```bash
npm run db:push
```

### Step 2: Manual scenario checks (no PII)

#### Scenario A: Calendly Link A configured
1. Set `WorkspaceSettings.meetingBookingProvider = "CALENDLY"`
2. Set `WorkspaceSettings.calendlyEventTypeLink` to a valid Calendly event type link (Link A)
3. Generate an AI email draft for a lead who should receive scheduling content
4. **Expected:** draft includes Link A (and Step 3 enforcement keeps it canonical)

#### Scenario B: Calendly Link A missing
1. Keep provider `CALENDLY`
2. Clear `WorkspaceSettings.calendlyEventTypeLink`
3. Generate an AI email draft
4. **Expected:** draft contains **no** booking link; Step 3 enforcement removes any booking links that appear

#### Scenario C (Optional): Pricing drift
N/A — confirmed out of scope for Phase 64 (custom instructions).

### Step 3: Document results
- Record which scenarios were verified and their outcomes.

## Output
- `npm run lint` passes
- `npm run build` passes
- Scenario A/B behave as expected (Link A used when set; no stale links when unset)
- Pricing drift confirmed out-of-scope (custom instructions)

## Handoff
Proceed to Phase 64f to add regression tests and rollout notes so this doesn’t regress.
