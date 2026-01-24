# Phase 51b — Inbound Post-Process Kernel Extraction + First Migrations

## Focus

Extract the shared inbound post-processing orchestration spine into a shared kernel module while preserving provider/channel-specific logic via adapters to reduce drift risk across automation entrypoints.

## Inputs

- Group A findings in `docs/audits/structural-duplication-2026-01-22.md`
- Phase 51a invariants and kernel boundary decisions
- Current pipeline entrypoints:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/smartlead-inbound-post-process.ts`
  - `lib/background-jobs/instantly-inbound-post-process.ts`
  - `lib/background-jobs/linkedin-inbound-post-process.ts` (out of scope for this migration)

## Pre-Flight (RED TEAM)

- [x] Confirmed working tree is **not** clean (Phase 48–50 carry uncommitted changes). Proceeded anyway and documented below.
- [x] Confirmed SmartLead + Instantly pipelines were structurally identical aside from log prefixes/function names.
- [x] Read current versions of both files to ensure no provider-specific divergences before extracting the kernel.

## Work

1. **Design the kernel interface**:
   - Define an adapter contract for channel/provider-specific logic:
     ```typescript
     interface InboundAdapter {
       channel: "email" | "sms" | "linkedin";
       provider?: "smartlead" | "instantly" | "emailbison";
       buildTranscript(params: TranscriptParams): Promise<TranscriptResult>;
       classifySentiment(params: ClassifyParams): Promise<SentimentResult>;
       runEnrichment?(params: EnrichmentParams): Promise<void>;
       shouldDraft(sentimentTag: string | null, lead: LeadData): boolean;
       postDraft?(params: PostDraftParams): Promise<void>;
     }
     ```
   - Kernel receives: `{ clientId, leadId, messageId, adapter }`.
   - Kernel returns: `{ success: boolean; stageLogs: string[] }`.

2. **Implement the kernel (new module)**:
   - Create `lib/inbound-post-process/pipeline.ts`:
     - Shared orchestration ordering (canonical stage sequence):
       1. Load message + lead + client + campaign
       2. Build transcript (via adapter)
       3. Classify sentiment (via adapter)
       4. Update lead status + assignment (maybeAssignLead)
       5. Pause follow-ups on reply
       6. Snooze detection + follow-up pause-until
       7. Auto-booking check (email channels only)
       8. Reject drafts on blacklist/automated
       9. Optional enrichment (via adapter)
       10. Draft generation + auto-send orchestration
       11. Bump rollups + enqueue lead scoring
   - Create `lib/inbound-post-process/types.ts` for shared types.
   - Create `lib/inbound-post-process/index.ts` for public exports.

3. **Migrate the closest pair first (SmartLead + Instantly)**:
   - Create adapters:
     - `lib/inbound-post-process/adapters/smartlead.ts`
     - `lib/inbound-post-process/adapters/instantly.ts`
   - Update `runSmartLeadInboundPostProcessJob(...)` to call the kernel with the adapter.
   - Update `runInstantlyInboundPostProcessJob(...)` to call the kernel with the adapter.
   - Remove duplicated orchestration code from both files.

4. **Preserve behavior and contracts**:
   - Keep job payloads stable (`{ clientId, leadId, messageId }`).
   - Preserve logging format (`[SmartLead Post-Process]` vs `[Instantly Post-Process]`).
   - Preserve telemetry/AIInteraction attribution.
   - Keep `mapInboxClassificationToSentimentTag()` and `applyAutoFollowUpPolicyOnInboundEmail()` as adapter-level helpers (shared between SmartLead/Instantly).

5. **Regression coverage**:
   - Add unit tests for kernel stage ordering:
     - `lib/inbound-post-process/__tests__/pipeline.test.ts`
   - Assert that both adapters produce the same stage sequence for equivalent inputs.
   - Assert that skipped stages are logged correctly.

## Validation (RED TEAM)

- `npm run lint` — no errors.
- `npm run build` — no type errors.
- `npm run test` — all tests pass (including Phase 48 orchestrator tests).
- Manual smoke test: trigger SmartLead inbound webhook → verify draft generated, auto-send evaluated, lead scored.
- Manual smoke test: trigger Instantly inbound webhook → verify same behavior.
- Confirm logging format unchanged: `[SmartLead Post-Process]` and `[Instantly Post-Process]` prefixes preserved.

## Output

- Added a shared inbound post-process kernel module: `lib/inbound-post-process/`:
  - `lib/inbound-post-process/pipeline.ts` — extracted orchestration spine (stage-logged)
  - `lib/inbound-post-process/types.ts` — adapter + stage typings
  - `lib/inbound-post-process/adapters/smartlead.ts`
  - `lib/inbound-post-process/adapters/instantly.ts`
  - `lib/inbound-post-process/index.ts`
- Migrated SmartLead and Instantly job entrypoints to the kernel (preserving log prefixes):
  - `lib/background-jobs/smartlead-inbound-post-process.ts`
  - `lib/background-jobs/instantly-inbound-post-process.ts`
- Deferred: unit tests for stage ordering (to Phase 51e, after prompt-runner migration and test harness expansion).

## Handoff

Subphase c unifies outbound email reply sending behind a single internal pipeline used by both manual and draft-approval paths.

## Coordination Notes

- Proceeded with a dirty working tree (existing Phase 48–50 changes). No semantic conflicts observed in the migrated inbound job files because SmartLead/Instantly content was replaced entirely by kernel delegation.
- Files added are currently untracked (new module directory); ensure they are committed together with Phase 51 changes before merge/deploy.

## Assumptions / Open Questions (RED TEAM)

- Assumption: `mapInboxClassificationToSentimentTag()` and `applyAutoFollowUpPolicyOnInboundEmail()` are identical between SmartLead and Instantly (confidence ~95%).
  - Mitigation check: diff both files before starting.
- Assumption: Transcript building stays outside the kernel (adapters handle it) per Phase 51a boundary decision (confidence ~90%).
- Open question: Should email and SMS pipelines also migrate to the kernel in this subphase?
  - Current default: No — focus on SmartLead + Instantly first; email/SMS migration is a follow-up.
