# Phase 147d - Regression Tests and Mandatory Validation Gates (NTTAN)

## Focus
Prove that LinkedIn/SMS reliability fixes work without regressing AI drafting/reply behavior or channel send paths.

## Inputs
- Code changes from Phases 147b and 147c
- Existing test harnesses in `lib/__tests__`, `scripts/test-ai-drafts.ts`, and `scripts/live-ai-replay.ts`

## Work

### 1. Add targeted unit tests (primary validation — these test the actual fix)

Create `lib/__tests__/followup-engine-channel-reliability.test.ts` with cases:

- LinkedIn company URL (`linkedin.com/company/acme`) => `action: "skipped"`, `advance: true`, FollowUpTask recorded with `"LinkedIn skipped — URL is not a person profile"`.
- LinkedIn `/school/`, `/showcase/`, malformed URLs => same skip+advance behavior.
- LinkedIn valid person profile (`linkedin.com/in/john-doe`) => proceeds to send path (no skip).
- LinkedIn unresolvable member target => `action: "skipped"`, `advance: true`.
- SMS `invalid_country_code` error => `action: "skipped"`, `advance: true`, FollowUpTask recorded.
- SMS missing phone (existing behavior) => still works as before (regression guard).
- SMS valid phone => proceeds to send path (no skip).
- Backstop filter: company URL instance => skip+advance during cron sweep.

### 2. Run phase validation suite

- `npm run lint`
- `npm run build`

### 3. Run NTTAN gates (regression guards — these do NOT test follow-up execution)

AI replay and AI drafts test the draft generation pipeline, not follow-up step execution. They are included as regression guards to ensure the changes in `followup-engine.ts` don't inadvertently break AI behavior.

**Note:** These should run against the current working tree, which includes uncommitted phase 146 changes in AI files. Accept this as the baseline.

- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

### 4. Incident-focused validation with Tim Blais workspace

- `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3`

### 5. Record failures with actionable remediation before phase closure.

## Output
A validated reliability change set with passing tests/gates and incident-specific replay evidence.

## Handoff
Phase 147e performs rollout verification in production data and confirms closure criteria for Tim Blais and broader client behavior.
