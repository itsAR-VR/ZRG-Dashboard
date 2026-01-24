# Phase 54b — Anchor Discovery Algorithm (DB + EmailBison + GHL-Assisted)

## Focus
Design a deterministic, provider-safe algorithm to discover a usable thread anchor starting from the lead’s email address, using DB state first and then provider lookups (EmailBison, plus GHL-assisted fallbacks).

## Inputs
- Phase 54a anchor contract + failure-mode matrix
- Existing helpers:
  - `lib/emailbison-api.ts` (`findEmailBisonLeadIdByEmail`, `fetchEmailBisonReplies`, `fetchEmailBisonRepliesGlobal`, `fetchEmailBisonLeadReplies`)
  - `lib/ghl-api.ts` (`searchGHLContactsAdvanced`, contact fetch/update primitives)
- Existing DB fields on `Lead`/`Message` (e.g., `Lead.emailBisonLeadId`, `Message.emailBisonReplyId`, `Lead.ghlContactId`)

## Work
- Specify a single function contract (to implement in 54d), e.g.:
  - `resolveReactivationEmailAnchor({ clientId, leadId, leadEmail, desiredCampaignId? }) -> { emailBisonLeadId, anchorReplyId, anchorCampaignId?, anchorKind, confidence }`
- Define deterministic precedence:
  1) **DB-first**: if we already have a stable thread handle for this lead (e.g., latest outbound EmailBison `Message.emailBisonReplyId`), prefer it.
  2) **EmailBison lookup by email**:
     - Prefer `Lead.emailBisonLeadId`, else `findEmailBisonLeadIdByEmail`, else `fetchEmailBisonRepliesGlobal(search=email)` to infer lead_id.
  3) **EmailBison replies selection**:
     - Prefer sent-folder replies.
     - Prefer campaign match if `desiredCampaignId` is configured.
     - Provide controlled fallbacks when campaign id is missing/unset (avoid returning `null` when an in-thread reply target exists).
  4) **GHL-assisted discovery** (when EmailBison lead id lookup fails or email mismatches are suspected):
     - Search contacts by email in GHL.
     - Use GHL findings to retry EmailBison lookup (e.g., alternative email casing/address if present, or other reference fields if available).
     - Persist any recovered IDs back onto `Lead` to reduce future provider calls.
- Define caching + rate-limit posture:
  - Avoid repeated provider lookups in the same run (per-client + per-email cache).
  - Bound pagination/queries to avoid “burst → timeout” patterns (align with Phase 53).

## Output
- A written algorithm + decision table mapping each 54a failure mode to a discovery path and expected return value.

## Handoff
Use the discovery algorithm outputs to define **what "creation" means** when nothing is discoverable in **54c**.

## Validation (RED TEAM)

- [ ] Verify `findEmailBisonLeadIdByEmail()` (lib/emailbison-api.ts:1099) handles email casing normalization
- [ ] Verify `fetchEmailBisonRepliesGlobal()` (lib/emailbison-api.ts:1134) can search by email as documented
- [ ] Confirm `searchGHLContactsAdvanced()` (lib/ghl-api.ts:774) supports email-based lookup
- [ ] Test each lookup path with example data before implementation
- [ ] Ensure timeout handling aligns with Phase 53 patterns (30s max per provider call)

## Resolved Decisions (RED TEAM)

- **Per-run caching** (confirmed needed): Map<email, bisonLeadId> to avoid repeated lookups for same email across enrollments
  - Impact if wrong: Duplicate API calls → timeout cascades

- **GHL ID persistence** — DECIDED: Yes, persist `Lead.ghlContactId` when GHL discovery succeeds

- **Anchor selection priority** — DECIDED (always pick **most recent by date** within each tier):
  1. Most recent sent-folder reply with campaign_id (best)
  2. Most recent sent-folder reply without campaign_id (acceptable)
  3. Most recent reply by date from any folder (thread continuation fallback)
  4. `needs_review` with actionable message
  - **Never use a random reply_id** — sort replies by date descending, pick newest from highest-priority tier

## Open Questions (remaining)

- **GHL-assisted recovery rate** (unknown): How often does GHL have contact data when EmailBison lookup fails?
  - Mitigation: Add telemetry to measure recovery rate in first rollout

## Output (Filled)

### Proposed function contract (for 54d)

Implement a single helper used by both batch resolution and send-on-demand:

`resolveReactivationEmailAnchor({ enrollmentId, lead, campaign, client }) -> { ok, emailBisonLeadId?, anchorReplyId?, anchorCampaignId?, originalSenderEmailId?, anchorKind, reason? }`

Where:
- `anchorReplyId` is always an EmailBison `reply.id` usable in `POST /api/replies/:id/reply`.
- `anchorCampaignId` and `originalSenderEmailId` are best-effort metadata (nullable).
- `anchorKind` describes which tier produced the anchor:
  - `db_outbound` (best): latest outbound `Message.emailBisonReplyId` for this lead
  - `db_any`: latest any-direction `Message.emailBisonReplyId` for this lead
  - `sent_campaign_match`: sent-folder reply for configured campaign
  - `sent_any`: sent-folder reply (any campaign / campaign_id missing)
  - `any_folder`: newest reply across all folders

### Deterministic precedence (algorithm)

0) **Input validation**
- Require `lead.email` (query already enforces, but guard anyway).

1) **DB-first anchor (no provider calls)**
- If we have any EmailBison reply ids stored on `Message` for this `leadId`, prefer:
  - Latest outbound email (`direction="outbound"`, `source="zrg"`, `emailBisonReplyId != null`)
  - Else latest email message with `emailBisonReplyId != null` (any direction/source)
- If found, return `{ ok: true, anchorReplyId, anchorKind: "db_outbound" | "db_any" }`.

2) **EmailBison lead_id discovery (by email)**
- Prefer `Lead.emailBisonLeadId` if present.
- Else consult per-run cache `Map<normalizedEmail, leadId|null>`.
- Else attempt in order (stop on success):
  1. `findEmailBisonLeadIdByEmail(apiKey, leadEmail)`
  2. `fetchEmailBisonRepliesGlobal(apiKey, { search: leadEmail })` → pick newest reply with `lead_id`
  3. (Optional, only if `desiredCampaignId` exists and the above fail) scan a small number of `fetchEmailBisonCampaignLeadsPage()` pages to match email.

3) **GHL-assisted fallback (only when EmailBison lead_id not found)**
- If the workspace has GHL credentials (`ghlPrivateKey` + `ghlLocationId`), run:
  - `searchGHLContactsAdvanced({ filters: [{ field: "email", operator: "eq", value: normalizedEmail }], pageLimit: 1 })`
  - If found, persist `Lead.ghlContactId` when missing (best-effort).
  - If the found contact’s email differs from `Lead.email`, retry step (2) with that email (best-effort).
- Hard bound: at most 1 GHL search per enrollment (avoid timeout cascades).

4) **EmailBison reply selection (tiered)**
- Fetch replies for the resolved `emailBisonLeadId` (existing `fetchEmailBisonReplies` is sufficient; optimization to filtered replies is optional).
- Choose anchor using the Phase 54a tier rules (always newest-by-date within each tier):
  1. sent-folder reply with campaign_id matching `desiredCampaignId`
  2. sent-folder reply without campaign match (including missing campaign_id)
  3. newest reply across any folder
  4. no replies → `{ ok: false, reason: "no_replies_no_thread" }`

### Decision table: failure mode → discovery path → expected return

| Failure mode | Path | Expected return |
|---|---|---|
| Anchor missing because campaign mismatch | Step 4 tier 2 | `ok: true`, `anchorKind: "sent_any"` |
| Anchor missing because sent reply missing campaign_id | Step 4 tier 2 | `ok: true`, `anchorCampaignId: null` |
| No sent-folder replies | Step 4 tier 3 | `ok: true`, `anchorKind: "any_folder"` |
| No EmailBison lead_id stored | Step 2 | `ok: true` once lead_id found; else continue to step 3 |
| EmailBison lead_id lookup fails | Step 3 | best-effort recovery; may still return `ok: false` |
| No replies/thread exists | Step 4 tier 4 | `ok: false`, `reason: "no_replies_no_thread"` |

## Handoff (Filled)

Proceed to **54c** to finalize the “creation” story given provider reality:
- confirm there is no viable new-thread send primitive for EmailBison in our integration
- define the exact `needs_review` reason and operator remediation for “no thread exists”
