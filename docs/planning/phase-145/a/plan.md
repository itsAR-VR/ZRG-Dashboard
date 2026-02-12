# Phase 145a — Decision Contract + Binary Extraction

## Focus

Implement and enforce AI decision contract v1 for message handling with binary extraction outputs (`yes|no`) and evidence.

## Inputs

- `docs/planning/phase-145/plan.md`
- Existing extraction/router surfaces in:
  - `lib/meeting-overseer.ts`
  - `lib/action-signal-detector.ts`
  - `lib/ai-drafts.ts`
  - `lib/ai/prompt-registry.ts`

## Contract Relationship (RED TEAM)

`AIDecisionContractV1` is an **orchestration-layer contract** that composes outputs from existing extraction systems:
- `MeetingOverseerExtractDecision` (`lib/meeting-overseer.ts`) → feeds `hasBookingIntent`, `shouldBookNow`, `leadTimezone`, `leadProposedWindows`
- `ActionSignalDetectionResult` (`lib/action-signal-detector.ts`) → feeds process routing / P4/P5 detection
- `AutoBookingContext` (`lib/followup-engine.ts`) → feeds `isQualified`

It does NOT replace these contracts. It provides a unified binary decision surface consumed by downstream execution logic.

## Work

1. Create `lib/ai/decision-contract.ts` — define `AIDecisionContractV1` type, JSON schema, validation, and repair logic.
2. Implement composition function that maps existing extraction outputs into the unified contract.
3. Add `responseMode` derivation logic — map from extraction fields to `"booking_only" | "info_then_booking" | "clarify_only"` using deterministic rules (not a new AI call).
4. Update extraction prompt(s) to emit only binary fields and required evidence.
5. Add strict schema validation and a single repair attempt path.
6. Classify invalid/missing outputs as `decision_error`.
7. Preserve backward compatibility where current callers still expect legacy fields.
8. Add migration mapping notes for phase 142 confidence-oriented qualification handling.
9. **Phase 142 coordination:** Check if `BookingQualificationJob` schema changes are committed. The `isQualified` binary field must not conflict with 142's qualification confidence paths — binary extraction for contract, confidence stays gate-only.

## Edge Cases

- Missing `leadTimezone` while `shouldBookNow=yes`.
- Conflicting extracted signals (e.g., `hasBookingIntent=no` + `shouldBookNow=yes`).
- Ambiguous lead message with mixed booking/info intent.

## Validation

- Unit tests for schema acceptance/rejection.
- Unit tests for repair path.
- Unit tests for composition function (existing extractions → contract).
- Unit tests for `responseMode` derivation logic.
- `npm run lint`, `npm run build`, `npm run test`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Output

- Binary extraction contract is authoritative and versioned.
- Invalid extraction outputs are explicitly surfaced as decision failures.

## Handoff

145b consumes this contract for execution logic and booking/timezone behavior.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `lib/ai/decision-contract.ts` with:
    - `AIDecisionContractV1` schema/type,
    - deterministic derivation from overseer extraction,
    - strict validator,
    - single repair-path helper.
  - Wired contract attachment into `lib/meeting-overseer.ts`:
    - extraction results now attach `decision_contract_v1`,
    - status/error fields (`decision_contract_status`, `decision_contract_error`) are set,
    - cached/existing extraction payloads are normalized with contract attachment before return.
  - Added tests:
    - `lib/__tests__/ai-decision-contract.test.ts` (derive, validate, repair).
  - Added new suite to orchestrator:
    - `scripts/test-orchestrator.ts`.
  - Multi-agent coordination notes:
    - touched `lib/meeting-overseer.ts`, which overlaps recent phases `138/139/141/143`;
      edits were kept symbol-scoped (type extension + contract attach path only) with no booking-route rewrites.
- Commands run:
  - `node --conditions=react-server --import tsx --test lib/__tests__/ai-decision-contract.test.ts` — pass (4/4).
  - `npm run lint` — pass (warnings only, no new errors).
  - `npm run build` — pass.
  - `npm run test` — pass (372 pass, 0 fail).
  - NTTAN:
    - `npm run test:ai-drafts` — pass.
    - `npm run test:ai-replay -- --client-id 29156db4-e9bf-4e26-9cb8-2a75ae3d9384 --dry-run --limit 20` — fail (0 selected cases).
    - `npm run test:ai-replay -- --client-id 29156db4-e9bf-4e26-9cb8-2a75ae3d9384 --limit 20 --concurrency 3` — fail (0 selected cases).
    - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20` — pass (20 selected).
    - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3` — partial/blocker (`P2022` column-not-found during `generateResponseDraft`, evaluated=0 failed=16).
- Blockers:
  - Live replay gate is blocked by runtime DB/schema mismatch (`P2022`) for active client replay execution.
  - Candidate-selection for client `29156...` returns no cases; this client is not viable for NTTAN replay gating.
- Next concrete steps:
  - Use `ef824...` as canonical replay client in this phase.
  - Resolve `P2022` replay DB/schema mismatch (likely by syncing schema/environment used by replay runtime) before marking 145a fully closed.
  - Proceed to 145b booking-execution changes while replay infra blocker is tracked explicitly.
