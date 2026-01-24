# Phase 53f — Integration Health States (GHL + Unipile) + Verification/Rollback Runbook

## Focus
Convert recurring integration failures into bounded, actionable states:
- GHL contact sync should either succeed or produce a diagnosable, retryable error with backoff.
- Unipile disconnected accounts should auto-disable LinkedIn automation and surface remediation.
- Invalid LinkedIn recipients should be quarantined per-lead to avoid infinite retries.

## Inputs
- GHL contact management:
  - `lib/ghl-contacts.ts` (`ensureGhlContactIdForLead`, `syncGhlContactPhoneForLead`)
  - Call sites in inbound post-processors (`lib/background-jobs/*-inbound-post-process.ts`)
- Unipile:
  - `lib/unipile-api.ts:checkLinkedInConnection()`
  - Follow-up engine call sites (LinkedIn followups)
- Observed failures:
  - `[GHL Contact] ... Failed to upsert contact in GHL` (6; low diagnostic value)
  - `[ConversationSyncJob] SMS sync failed ... no GHL contact ID` (2)
  - `[Unipile] Connection check failed (401 disconnected)` and `(422 invalid_recipient)` (4)

## Work
1. **Define integration “health states” in DB**
   - Add per-client integration health fields (or a dedicated table) to record:
     - `status` (OK / DEGRADED / DISCONNECTED)
     - `lastCheckedAt`, `lastErrorCode`, `lastErrorAt`
   - Use these states to short-circuit automation attempts when the integration is known-bad.

2. **GHL: improve error diagnostics and retries**
   - Ensure `ensureGhlContactIdForLead` returns actionable error categories:
     - missing credentials, permission denied, rate limited, validation error, network timeout, unknown.
   - Add bounded retry/backoff scheduling (background job), not “retry in the same request”.
   - Suppress repetitive “Failed to upsert” logs; log once per error window with safe context.

3. **SMS sync: skip vs repair**
   - If a lead lacks `ghlContactId`, either:
     - attempt a repair path (search/create in GHL) when sufficient identifiers exist, or
     - skip cleanly without warning spam, and record “needs repair” state for operators.

4. **Unipile: handle 401/422 as control flow**
   - On `401 disconnected_account`:
     - mark workspace/client LinkedIn integration as DISCONNECTED
     - disable LinkedIn follow-ups automatically
     - notify via Slack (safe)
   - On `422 invalid_recipient`:
     - mark lead’s LinkedIn handle as “unreachable” (new per-lead flag)
     - stop/skip LinkedIn follow-ups for that lead until manually corrected

5. **Verification + rollback runbook**
   - Add a concise post-deploy checklist:
     - verify webhook ingestion p95 < 1s and no 504s during burst simulation
     - verify no `57014 statement timeout` for inbox counts
     - verify no `refresh_token_not_found` error spam
     - verify Unipile disconnected accounts are auto-disabled
   - Rollback strategy:
     - feature-flag off async webhook processing if queueing regresses ingestion
     - feature-flag off auto-disable behaviors if they block legitimate traffic

## Output
- **Unipile health gating + per-lead quarantine**
  - `prisma/schema.prisma` adds `Lead.linkedinUnreachableAt` + `Lead.linkedinUnreachableReason` for per-lead “recipient cannot be reached” quarantine.
  - `lib/unipile-api.ts` now parses and propagates Unipile `401 disconnected_account` and `422 recipient_cannot_be_reached` as structured flags (`isDisconnectedAccount`, `isUnreachableRecipient`) including when the failure happens during connection checks.
  - `lib/followup-engine.ts` gates LinkedIn follow-ups when `UNIPILE_HEALTH_GATE=1`:
    - If workspace is marked disconnected, pauses instances (`pausedReason="unipile_disconnected"`).
    - If lead is marked unreachable, pauses instances (`pausedReason="linkedin_unreachable"`).
    - On 401/422 send failures, updates workspace/lead state and pauses instead of repeatedly retrying.
  - `actions/message-actions.ts` updates Unipile health on manual LinkedIn sends and status checks; marks leads unreachable on 422 when `UNIPILE_HEALTH_GATE=1`.
  - `lib/workspace-integration-health.ts` avoids redundant “reconnected” writes/logs by only updating state when it changes.

- **GHL diagnostics + SMS sync noise reduction**
  - `lib/ghl-api.ts:upsertGHLContact()` now normalizes multiple possible response shapes to extract a contact ID; eliminates the silent “success but missing contactId” path that produced low-signal errors.
  - `lib/conversation-sync.ts` treats “no ghlContactId + no existing SMS messages” as a no-op success (email-only leads), reducing `[ConversationSyncJob] ... no GHL contact ID` warning spam.

- **Runbook**
  - Added `docs/planning/phase-53/runbook.md` with deploy order, verification checks, and rollback steps (including feature flags and backfill guidance).

## Handoff
Phase 53 implementation can proceed in order a→f; after deploy, run the verification checklist and capture outcomes in a `review.md`.
