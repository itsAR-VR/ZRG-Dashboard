# Phase 133d — Tests + Quality Gates + Rollout Notes

## Focus
Add minimal tests for reply UUID selection logic, ensure the repository’s test orchestrator runs them, and document any rollout notes (especially white-label base host behavior).

## Inputs
- `lib/emailbison-deeplink.ts` helper (Phase 133a)
- Existing test harness uses an explicit allowlist in `scripts/test-orchestrator.ts`

## Work
1. Add unit test file:
   - `lib/__tests__/emailbison-deeplink.test.ts`
   - Test cases (locked):
     - prefers matching numeric reply `id` when that reply includes a `uuid`
     - falls back to newest reply with `uuid` when preferred id is missing
     - returns `null` when no replies include a UUID
2. Add the new test file to `scripts/test-orchestrator.ts` `TEST_FILES` list.
   - Coordination note: this file is currently modified in the working tree (Phase 132). Re-read and merge carefully.
3. Run quality gates:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
4. Rollout notes (include in Phase 133 root summary or PR description):
   - Button visibility is gated on `lead.emailBisonLeadId`
   - Base origin precedence:
     - `Client.emailBisonBaseHost.host` (workspace-specific) wins
     - fallback `EMAILBISON_BASE_URL`
     - final fallback `https://send.meetinboxxia.com`

## Planned Output
- Passing checks and a documented, test-covered UUID selection strategy.

## Planned Handoff
- Feature is ready to ship for EmailBison. SmartLead and Instantly deep links remain deferred until sample UI URLs are provided.

## Output
- Added `lib/__tests__/emailbison-deeplink.test.ts`.
- Added test file to `scripts/test-orchestrator.ts`.
- Quality gates:
  - `npm run lint` — pass (warnings only)
  - `npm run typecheck` — pass
  - `npm test` — pass

## Handoff
- Phase 133 is ready to ship for EmailBison deep links.
- Rollout notes:
  - Button visibility is gated on `lead.emailBisonLeadId`.
  - Base origin precedence: `Client.emailBisonBaseHost.host` → `EMAILBISON_BASE_URL` → `https://send.meetinboxxia.com`.
  - SmartLead/Instantly deep links remain deferred.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added unit coverage for the reply UUID selection helper and ensured it is included in the test orchestrator allowlist.
  - Ran lint/typecheck/tests to verify the end-to-end wiring (server action + UI) compiles and is covered.
- Commands run:
  - `npm run lint` — pass (warnings only)
  - `npm run typecheck` — pass
  - `npm test` — pass
- Blockers:
  - None
- Next concrete steps:
  - Run Phase 133 review and write `docs/planning/phase-133/review.md`.
