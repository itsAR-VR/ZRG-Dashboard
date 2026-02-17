# Phase 161b Root-Cause Analysis — `/api/inbox/conversations` 503 Burst

## Scope
This analysis is for the incident signature captured in:
- `docs/planning/phase-161/artifacts/incident-evidence-2026-02-16.md`
- `docs/planning/phase-161/artifacts/log-export-2026-02-16T16-16-06-summary.json`

## Verified 503 Paths (Current Head)
- `app/api/inbox/conversations/route.ts`
  - `503` is returned only in `READ_API_DISABLED` branch:
    - `if (!isInboxReadApiEnabled() && !shouldFailOpenReadApi(request))`
- Other error branches map to:
  - `401` / `403` from auth failures,
  - `500` fallback via `mapActionErrorToStatus`.

## Runtime Flag Semantics (Current Head)
- `lib/feature-flags.ts` resolves read API enablement as:
  1. server env (`INBOX_READ_API_V1`),
  2. public env (`NEXT_PUBLIC_INBOX_READ_API_V1`),
  3. production fail-open when both unset.
- Production env snapshot (current) includes:
  - `INBOX_READ_API_V1="true"`
  - no `NEXT_PUBLIC_INBOX_READ_API_V1` entry in pulled env file.

## Historical Drift Evidence
- `git show b4a0112:lib/feature-flags.ts` shows pre-hardening behavior:
  - read API keyed only off `NEXT_PUBLIC_INBOX_READ_API_V1`,
  - missing value implicitly disabled read API (fail-closed).
- `git show 45b7d02 -- lib/feature-flags.ts` shows hardening fix:
  - added server env support (`INBOX_READ_API_V1`),
  - added explicit false parsing and production fail-open fallback.
- `git show 45b7d02 -- app/api/inbox/conversations/route.ts` added:
  - structured disabled logs,
  - `x-zrg-read-api-reason: disabled_by_flag`,
  - request-id propagation.

## Incident Deployment Correlation
- Incident export deployment: `dpl_AnY8GbAhbg62bW875FgQFyMhNxmJ`
  - created: `2026-02-16 12:07:07 UTC`.
- Hardening deployment candidate: `dpl_5qa59vkjGcif5g3NbEc3pdEJ5dpb`
  - created: `2026-02-16 13:20:49 UTC`.
- Incident burst timestamps: `2026-02-16 16:03:30` → `16:03:39 UTC`.

## Root Cause Conclusion
Most likely root cause: **read API was effectively disabled by pre-hardening feature-flag semantics on the incident deployment**, causing intentional `503 READ_API_DISABLED` responses for every `/api/inbox/conversations` read call without fail-open header.

Why this conclusion is high-confidence:
1. Incident signature is pure, fast `503` traffic on a single read endpoint (`~10ms` function durations), consistent with early-return flag gate.
2. Current route has a single intentional `503` branch and no competing `503` error path.
3. Historical code confirms an older fail-closed flag implementation that can disable reads when `NEXT_PUBLIC_INBOX_READ_API_V1` is unset.
4. Current hardened code and env settings no longer reproduce the same 503 behavior on current production alias.

Confidence: **~0.9**

## Residual Uncertainty
- Why the 16:03 UTC burst mapped to `dpl_AnY...` despite later production deployments existing remains unresolved from current exports alone.
- This does not change branch attribution (still consistent with `READ_API_DISABLED`) but should be validated with deployment-alias history in Vercel dashboard activity for final incident postmortem completeness.

## Chosen Remediation Direction (for 161c)
1. Keep hardened flag semantics from current head (`lib/feature-flags.ts`) as source-of-truth.
2. Ensure production uses hardened deployments (no rollback to pre-hardening behavior).
3. Use existing reason headers/logging for disabled-path attribution and add closure evidence from current runtime checks/logs.
