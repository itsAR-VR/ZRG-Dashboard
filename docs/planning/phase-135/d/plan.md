# Phase 135d — Apply + Verify Founders Club Override Rebase

## Focus

Complete the pending operational step from Phase 135a by applying the Founders Club `draft.verify.email.step3.v1` workspace override rebase in the intended environment and verifying the override remains active under hash drift checks.

## Inputs

- Script: `scripts/rebase-email-step3-pricing-override.ts`
- Prompt default + hash helpers: `lib/ai/prompt-registry.ts`
- Drift model reference: Phase 129 (`PromptOverride` / `SystemPromptOverride`)
- Runtime fallback path: Supabase SQL (`PromptOverride` + `PromptOverrideRevision`) is available when local Prisma connectivity/import constraints block standalone script execution.

## Work

1. Establish runtime DB env for target environment (dev/staging/prod):
   - Confirm `DATABASE_URL` (and any required `DIRECT_URL`) is present.
   - Confirm the target `clientId` (default script value is Founders Club).
2. Execute script in dry-run mode:
   - `node --import tsx scripts/rebase-email-step3-pricing-override.ts --client-id <clientId>`
   - Confirm `patchChanged=true` or `reason=pricing_rule_already_patched`.
3. Execute apply mode:
   - `node --import tsx scripts/rebase-email-step3-pricing-override.ts --client-id <clientId> --apply`
   - Confirm override row updated and revision row created.
4. Verify effective resolution:
   - Confirm workspace override row has:
     - updated pricing rule (`PRICING VALIDATION`)
     - current `baseContentHash`
     - legacy pricing rule removed
   - Confirm revision row exists for traceability.
5. Prompt-editing continuity check:
   - Inspect whether active overrides exist for `draft.generate.sms.v1` and `draft.generate.linkedin.v1`.
   - If present and stale-hash is detected, re-save with current pricing guardrail wording.

## Validation (RED TEAM)

- Re-run script dry-run and apply with explicit command logs.
- Confirm no loss of Founders Club custom Step 3 rules 9-15 in final override content.
- Confirm `baseContentHash` on `PromptOverride` matches current computed base hash.
- Record telemetry sanity check plan: sample generated draft should not trigger unsupported `$3,000` pricing.

## Output

- Founders Club override rebased for `draft.verify.email.step3.v1`
  - override id: `47602877-c2e0-42b3-abce-97539bbde21a`
  - new base hash: `ff1b37a774dc601b`
  - pricing rule updated to `PRICING VALIDATION`
  - legacy `For pricing/fees:` line removed
- Revision row recorded for traceability
  - revision id: `manual_81a4e431327ce95f38155455`
  - action: `UPSERT`
  - createdByEmail: `script:rebase-email-step3-pricing-override`
- Prompt-editing continuity check completed for SMS/LinkedIn override keys
  - stale workspace overrides (`draft.generate.sms.v1`, `draft.generate.linkedin.v1`): `0`
  - stale system overrides (`draft.generate.sms.v1`, `draft.generate.linkedin.v1`): `0`

## Handoff

Return to root phase closeout. Remaining follow-up is runtime observation: verify a fresh Founders Club pricing inquiry draft outputs supported pricing and does not emit `$3,000`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Patched script runtime compatibility by removing direct `prompt-registry` import and computing Step 3 base hash from source content in-script.
  - Attempted local script execution with injected DB env; confirmed local runtime constraints (`P1001` DB reachability and standalone import limitations).
  - Executed production rebase through Supabase SQL with equivalent update semantics and revision insertion.
  - Verified override row state, revision traceability, custom-rule phrase preservation, and zero stale SMS/LinkedIn overrides.
  - Collected initial post-rebase production draft signal (`drafts_since_rebase=1`, `drafts_with_3000=0`).
- Commands run:
  - `node --import tsx scripts/rebase-email-step3-pricing-override.ts` (with injected env) — fail in local runtime (`P1001` reachability)
  - Supabase SQL update/insert CTE — pass (`updated_rows=1`, `revision_rows=1`)
  - Supabase SQL verification queries — pass
- Blockers:
  - None for DB update/verification path.
- Next concrete steps:
  - Trigger/observe one fresh Founders Club pricing draft and confirm pricing output behavior in live flow.
