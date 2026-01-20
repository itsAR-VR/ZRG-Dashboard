# Phase 44 — Bug Fixes: Email Bison Auth, Calendly Webhooks, AI Drafts

## Purpose

Fix three production bugs blocking core functionality: Email Bison 401 authentication errors (blocking all email sends), Calendly webhook signing key missing (rejecting all booking webhooks), and document the AI drafts timeout behavior (working as designed with fallback).

## Context

**Critical Issue (Email Bison):** Founders Club + ZRG are experiencing EmailBison `401` errors that strongly suggest a **base URL/API key mismatch**. When a workspace has no base host configured (`emailBisonBaseHostId: null`), requests default to `send.meetinboxxia.com`. Founders Club uses a different host (`send.foundersclubsend.com`), so their API key fails authentication.

**Error Message (Email Bison):**
```
EmailBison authentication failed (401) ({"data":{"success":false,"message":"The request is not authenticated. Ensure you are using the correct URL, and a key that exists for the URL."}}). This often means a URL/API key mismatch (the key does not exist for this base URL) or an invalid/expired key. Update your API key in Settings → Integrations. If the key is correct, confirm the EmailBison base host matches your account (Settings → Integrations → EmailBison Base Host; current host: send.meetinboxxia.com).
```

**Medium Issue (Calendly):** Founders Club has a Calendly webhook subscription but no signing key stored locally. Calendly only returns the signing key at webhook creation time (not on GET requests), so the key was likely lost when the webhook was created before the key-storage logic was added. All Calendly webhooks for this workspace are rejected with 503.

**Error Messages (Calendly):**
```
2026-01-19 22:20:11.856 [error] [Calendly Webhook] No signing key configured; rejecting webhook for client ef824aca-a3c9-4cde-b51f-2e421ebb6b6e
```
Path: `/api/webhooks/calendly/ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`

**Related Noise (Inbox Counts):** `Failed to get inbox counts: Error: Unauthorized` is logged by `actions/lead-actions.ts:getInboxCounts()` and is typically caused by auth/session state (signed-out, stale workspace selection, etc.). It is **not** a Calendly webhook error. Treat as out-of-scope for Phase 44 unless it persists after EmailBison/Calendly fixes (see Phase 42).

**Low Priority (AI Drafts):** OpenAI timeouts during draft generation fall back to deterministic templates. This is working as designed - no code changes needed.

**Error Message (AI Drafts):**
```
2026-01-20 03:43:16.178 [error] [AI Drafts] Retry after max_output_tokens failed: Error: Request timed out.
    at ni.makeRequest (.next/server/chunks/_a2689aaa._.js:668:55273)
    ...
2026-01-20 03:43:37.656 [error] [AI Drafts] OpenAI draft generation failed; using deterministic fallback draft. {
  leadId: 'baeef7e3-0a97-480c-ad6a-90297d9c8e6f',
  channel: 'sms',
  sentimentTag: 'Interested',
  refusal: null,
  details: 'incomplete=max_output_tokens output_types=reasoning'
}
2026-01-20 03:43:37.777 [info] [SMS Post-Process] Generated AI draft: ebfedfd8-f794-4465-95b8-cf55323b6555
```

## Database State (Pre-Fix)

**Email Bison Base Hosts Available:**
| ID | Host | Label |
|----|------|-------|
| `409b8abe-...` | `send.foundersclubsend.com` | Founders Club |
| `5377c3f9-...` | `send.meetinboxxia.com` | Inboxxia (default) |
> Note: IDs above are examples; always query for the real IDs in the target database before running updates.

**Active Workspaces (Per User):**
| Workspace | Expected Base Host |
|-----------|---------------------|
| Founders Club | `send.foundersclubsend.com` |
| ZRG | `send.meetinboxxia.com` |

**Calendly State (Founders Club):**
| Field | Value |
|-------|-------|
| `calendlyAccessToken` | ✅ Set |
| `calendlyWebhookSigningKey` | ❌ NULL |
| `calendlyWebhookSubscriptionUri` | ✅ Set (webhook exists) |

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 43 | Complete | None | Lead assignment - unrelated to these bugs |
| Phase 42 | Active/Recent | EmailBison auth + base host feature | Ensure Phase 42 schema/code is deployed to the target environment before applying Phase 44 data backfill; avoid duplicating EmailBison client changes in this phase |
| Phase 41 | Complete/Recent | EmailBison client | Verify current `lib/emailbison-api.ts` behavior before attributing 401s solely to base host mismatch |
| Phase 40 | Active | `scripts/crawl4ai/*` | No overlap |

## Objectives

* [x] Add per-workspace EmailBison base host selection in Settings → Integrations
* [x] Allow workspace admins to edit integrations (unblocks “can’t edit integrations”)
* [ ] Backfill Email Bison base hosts for workspaces with EmailBison API keys (optional SQL data fix; do not override non-null assignments)
* [x] Update `calendly-actions.ts` to force webhook recreation when signing key is missing locally
* [ ] Verify email sends work from Founders Club and ZRG workspaces (after deploy + host set)
* [ ] Verify Calendly webhooks are received after re-clicking "Ensure Webhooks" (after deploy + user action)

## Constraints

- Email Bison fix can be done either:
  - via the per-workspace UI (requires deploy), or
  - via SQL backfill (data-only; optional)
- Calendly fix requires code deployment + manual action (click "Ensure Webhooks")
- AI Drafts issue requires no changes (fallback working correctly)

## Success Criteria

- [ ] Email sends succeed from Founders Club workspace (after base host set + send test)
- [ ] Email sends succeed from ZRG workspaces (after base host set + send test)
- [ ] Calendly "Ensure Webhooks" stores signing key (after deploy + click)
- [ ] Calendly booking webhooks are received and processed (after deploy + test booking)
- [ ] No new errors in logs related to these issues (after deploy + monitoring)

## Subphase Index

* a — Email Bison base host data fix (SQL)
* b — Calendly webhook signing key code fix
* c — Verification and testing
* d — RED TEAM addendum (safe SQL + coordination + rollback)

## Repo Reality Check (RED TEAM)

- What exists today:
  - `Client.emailBisonBaseHostId` optional relation exists in `prisma/schema.prisma` and is used by EmailBison call sites when present.
  - Default base hosts are seeded by `actions/emailbison-base-host-actions.ts:getEmailBisonBaseHosts()` (includes `send.meetinboxxia.com` and `send.foundersclubsend.com`).
  - `actions/calendly-actions.ts:ensureCalendlyWebhookSubscriptionForWorkspace()` validates existing subscriptions and only sets `calendlyWebhookSigningKey` if `signing_key` is present in the Calendly response.
  - `app/api/webhooks/calendly/[clientId]/route.ts` returns `503` when no signing key is configured (per-workspace or env fallback).
- What the plan assumes:
  - Founders Club uses `send.foundersclubsend.com`; most other workspaces use `send.meetinboxxia.com`.
  - Calendly does not reliably return `signing_key` on GET subscription fetch, so a valid subscription can exist while the local signing key is null.
- Verified touch points:
  - `prisma/schema.prisma` (`Client.emailBisonBaseHostId`, `Client.calendlyWebhookSigningKey`, `EmailBisonBaseHost` model).
  - `lib/emailbison-api.ts` (`EmailBisonRequestOptions.baseHost`, `DEFAULT_EMAILBISON_BASE_URL`, 401 error message formatting).
  - `actions/calendly-actions.ts:ensureCalendlyWebhookSubscriptionForWorkspace`.
  - `app/api/webhooks/calendly/[clientId]/route.ts` (`503` on missing signing key; `401` on signature verify failure).

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Data backfill overwrites an already-correct `emailBisonBaseHostId` → silently breaks a workspace that uses a non-default base host.
  - Mitigation: updates must be **idempotent** and only apply where `emailBisonBaseHostId IS NULL` (and only where `emailBisonApiKey` is non-empty).
- Founders Club identified by `Client.name` in SQL, but name may not match exactly → no-op update → issue persists.
  - Mitigation: prefer `Client.id = ef824aca-a3c9-4cde-b51f-2e421ebb6b6e` for Founders Club (confirm in DB).
- Calendly webhook exists but local signing key missing → webhook returns 503, Calendly retries, but “Ensure Webhooks” may keep returning success without actually fixing.
  - Mitigation: force delete+recreate when `calendlyWebhookSigningKey` is missing locally and subscription appears valid.

### Repo mismatches (fix the plan)
- Phase 42 overlap was misclassified as “none”; it directly touches EmailBison base host + auth flows (coordination needed).
- Inbox counts unauthorized log line was previously listed under Calendly; it’s emitted by `actions/lead-actions.ts:getInboxCounts()` and is usually auth-state noise.

### Testing / validation gaps
- Need an explicit SQL “before/after” report: how many clients have `emailBisonApiKey` set but `emailBisonBaseHostId` null.
- Need a rollback path for the EmailBison data backfill (at minimum: snapshot list of affected client IDs + previous values).

## Open Questions (Need Human Input)

- [x] Confirmed: Only two workspaces exist right now (ZRG + Founders Club).
- [x] Confirmed: ZRG uses `send.meetinboxxia.com`.
- [ ] Should Phase 44 include a code hardening to auto-assign a default `emailBisonBaseHostId` when an EmailBison API key is first saved (to prevent future nulls)? (confidence <90%)
  - Why it matters: avoids repeating this incident for newly provisioned workspaces.
  - Current assumption in this plan: treat this as follow-up hardening (not required to unblock sends today).
- [x] Should the per-workspace EmailBison base host selection live in the workspace-level “Integrations” tab (workspace admins), or remain in the global “GHL Workspaces” admin screen only?
  - Answer: workspace-level Integrations (implemented in this working tree; see Phase 44 review).

## Assumptions (Confirmed by User)

- Only two active workspaces exist right now: ZRG + Founders Club.
- Expected EmailBison base hosts:
  - Founders Club → `send.foundersclubsend.com`
  - ZRG → `send.meetinboxxia.com`
- Per-workspace EmailBison base host selection is required (and is now implemented in this working tree; see Phase 44 review).

---

## Phase Summary

See `docs/planning/phase-44/review.md` for evidence + verification results.

### What Was Done (Working Tree)

1. **Email Bison Base Host Fix (UI-first):**
   - Added per-workspace EmailBison base host selection in Settings → Integrations (no SQL executed here).
   - Updated integrations edit gating so workspace admins can edit integrations.
   - **Result:** Founders Club/ZRG can set the correct base host via UI after deploy (no manual SQL required).

2. **Calendly Webhook Signing Key Fix:**
   - Updated `actions/calendly-actions.ts` so if a subscription exists but the local signing key is missing, it forces delete+recreate to capture the signing key on the next “Ensure Webhooks” click.

3. **AI Drafts Timeout (No Action):**
   - Confirmed fallback behavior is expected; no code changes required in this phase.

### Verification Status

- ✅ `npm run lint` (warnings only)
- ✅ `npm run build`
- ⏳ Production verification pending (deploy + send tests + Calendly booking test)
