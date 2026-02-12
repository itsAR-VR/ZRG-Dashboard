# Phase 143e — Unit Tests + Verification

## Focus

Write comprehensive unit tests covering heuristic detection, gating, false positive regression cases, and prompt appendix. Verify lint + build.

## Inputs

- `lib/action-signal-detector.ts` from Phase 143a
- `buildActionSignalsPromptAppendix()` from Phase 143d

## Work

### 1. Create `lib/__tests__/action-signal-detector.test.ts`

#### Sentiment gating tests
- "Not Interested" sentiment → empty result (no detection runs)
- "Blacklist" sentiment → empty result
- "Automated Reply" → empty result
- "Interested" sentiment → detection runs
- "Call Requested" sentiment → detection runs

#### Call signal heuristic tests
- Sentiment "Call Requested" → high confidence
- "can you call me tomorrow" in body → medium confidence
- "let's hop on a call" → medium confidence
- "give me a ring" → medium confidence
- "prefer a call" → medium confidence
- "let's schedule a meeting" (no call keyword) → null
- Empty text → null
- "Phone: 555-1234" (contact info, not request) → null

#### External calendar heuristic tests
- Calendly link in body ≠ workspace → high confidence
- Calendly link in body = workspace → null
- HubSpot meetings link in body → high confidence
- "book on my calendar" phrase → medium confidence
- "here's my Calendly link" phrase → medium confidence
- "book with my manager" → medium confidence
- Generic "book a meeting" → null
- No workspace link, any scheduler URL in body → high confidence

#### Tier 2 trigger condition tests
- Link in full text, NOT in stripped text, booking language present → Tier 2 triggered
- Link in stripped text → Tier 2 NOT triggered (Tier 1 caught it)
- Link in signature, NO booking language in body → Tier 2 NOT triggered (pre-filter blocks)
- No link anywhere → Tier 2 NOT triggered

#### False positive regression tests (CRITICAL)
- Email with Calendly in signature + "Thanks for the info!" → NO signal
- Email with Calendly in signature + "Sure, sounds good" → NO signal
- Email with Calendly in signature + "please book a time that works" → signal (AI disambiguation)
- Email with Calendly in body text + "here's my link" → signal (Tier 1, no AI)
- Email with workspace's own Calendly link in body → NO signal

#### Prompt appendix tests
- No signals → empty string
- Call signal → contains "phone call" instructions
- Calendar signal → contains "default booking link" warning
- Both signals → contains both instruction blocks

### 2. Run verification

```bash
npx vitest run lib/__tests__/action-signal-detector.test.ts
npm run lint
npm run build
```

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `lib/__tests__/action-signal-detector.test.ts` covering:
    - call + external-calendar heuristics,
    - signature disambiguation trigger conditions,
    - sentiment gating,
    - disambiguation path via injected stub (no live model call),
    - prompt appendix rendering (`buildActionSignalsPromptAppendix`).
  - Hardened detector reliability during test cycle:
    - added `shouldRunSignatureLinkDisambiguation(...)` helper,
    - added optional disambiguation injection hook in `detectActionSignals(...)`,
    - tightened signature pre-filter terms to scheduling-specific language.
- Commands run:
  - `DATABASE_URL='postgresql://test:test@localhost:5432/test?schema=public' DIRECT_URL='postgresql://test:test@localhost:5432/test?schema=public' OPENAI_API_KEY='test' node --conditions=react-server --import tsx --test lib/__tests__/action-signal-detector.test.ts` — pass (18 tests).
  - `npm run lint` — pass (warnings only; no errors).
  - `npm run build` — pass.
- Blockers:
  - None.
- Next concrete steps:
  - Final root-plan RED TEAM reconciliation + phase review artifact.

## Output

- New regression suite exists at `lib/__tests__/action-signal-detector.test.ts` with signature false-positive coverage and prompt appendix assertions.
- Verification gates passed for this phase scope (targeted tests, lint, build).
- Phase 143 implementation scope is complete.
- Coordination notes:
  - Build and lint were executed against concurrent dirty-tree changes; gates still passed after integrating 143 edits.

## Handoff

Phase 143 is done. All objectives met:
- Two-tier detection (heuristic + AI disambiguation)
- Signature false positives handled
- Positive sentiment gating
- Slack notifications with deduplication
- Draft generation context injection
- Tests with regression coverage
