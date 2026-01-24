# Phase 54c — Anchor Creation + Thread Selection Rules

## Focus
Define how to proceed when discovery cannot find a usable sent anchor and/or when no provider thread exists. Specify when to send in the existing thread versus starting a new one, and what artifacts must be persisted so subsequent sends behave deterministically.

## Inputs
- Phase 54b discovery algorithm and failure-mode mapping
- EmailBison provider capabilities available in-repo:
  - Known: reply-in-thread (`sendEmailBisonReply` via `POST /api/replies/:id/reply`)
  - Known: lead creation (`createEmailBisonLead`)
  - Unknown/needs verification: “new thread” send primitive (if any)

## Work
- Define a decision matrix for send mode:
  - **In-thread send** when a usable reply target exists (sent anchor preferred; otherwise best available in-thread anchor as defined in 54a/54b).
  - **New-thread send** only when there is no reply target at all.
- Specify what “create an anchor” means per case:
  - If a thread exists but no sent anchor: sending the bump itself can establish a new outbound reference; persist the resulting provider identifiers so future sends can anchor reliably.
  - If no thread exists:
    - Verify/implement the EmailBison API method for sending a new email (no reply target). If not available, define the fallback (e.g., enroll into a configured EmailBison campaign step, or explicitly mark `needs_review` with a precise reason until provider support is added).
    - If the lead does not exist in EmailBison, create it first and then start the thread.
- Specify provider payload differences:
  - When replying in-thread, `inject_previous_email_body` should remain enabled (current behavior).
  - When starting a new thread, do **not** inject previous body; subject handling and threading headers must follow provider requirements.
- Identify persistence requirements:
  - Which fields on `ReactivationEnrollment` and `Lead` must be written for each outcome (anchor ids, sender selection, provider message ids).

## Output
- A concrete "thread selection + creation" spec that unblocks implementation without ambiguity.

## Handoff
Implement the discovery + creation spec and add regression tests in **54d**.

## Validation (RED TEAM)

- [ ] Verify EmailBison API documentation for "new thread" send capability (search for `POST /api/leads/:id/emails` or equivalent)
- [ ] Test `sendEmailBisonReply()` with inbox reply_id (not sent folder) to confirm threading behavior
- [ ] Document fallback behavior when no provider "new thread" endpoint exists

## Resolved Decisions (from RED TEAM)

- **New-thread API: CONFIRMED NOT AVAILABLE** — EmailBison only supports `POST /api/replies/{reply_id}/reply`. No direct "send new email to lead" endpoint exists.
  - **Implication**: Phase 54 cannot implement "create thread when none exists." Leads with no email history must go to `needs_review` with message: "No email thread exists; enroll lead in EmailBison campaign to start conversation."

- **Anchor selection priority** — DECIDED:
  1. **First choice**: Most recent sent-folder reply with campaign_id (current behavior)
  2. **Second choice**: Most recent sent-folder reply without campaign_id (relaxed from current)
  3. **Third choice**: Most recent reply by date from any folder (maintains thread continuity)
  4. **Fallback**: `needs_review` with actionable message
  - Always sort replies by date (descending) and pick the newest matching each tier.
  - Do NOT pick a random or arbitrary reply — use the latest to ensure proper threading.

- **Lead creation without thread**: `createEmailBisonLead()` creates lead but NOT a thread. This is only useful for future campaign enrollment, not for immediate reactivation send.

## Updated Decision Matrix

| Scenario | Anchor Source | Action |
|----------|--------------|--------|
| Lead has sent reply with campaign_id | **Most recent** sent reply with campaign_id | Send in-thread ✓ |
| Lead has sent reply, no campaign_id | **Most recent** sent reply | Send in-thread ✓ |
| Lead has replies but none in sent folder | **Most recent** reply by date (any folder) | Send in-thread ✓ |
| Lead exists in EmailBison but has no replies | None | `needs_review`: "No email thread exists" |
| Lead not found in EmailBison | None | `needs_review`: "EmailBison lead not found" |

**Important**: Always select the most recent reply (sorted by `created_at` or `sent_at` descending) within each tier. Never use a random or arbitrary reply_id.

## Output (Filled)

### Thread selection rules (unambiguous)

- **We only support in-thread sends** for EmailBison reactivations because the only available provider primitive is `POST /api/replies/:id/reply`.
- **“Send in same thread”** means: choose an `anchorReplyId` from EmailBison replies and call `sendEmailBisonReply(anchorReplyId, ...)`.
- **“Send as new thread”** is **not supported** with the current EmailBison integration; when no replies exist, we must not attempt to send.

### What “create an anchor” means (given provider constraints)

- If the lead has an EmailBison thread (any replies exist) but we can’t find a “sent anchor”, we will:
  - select a best-available in-thread anchor using the tier rules (sent → any)
  - send the bump in-thread
  - persist the selected anchor + sender selection on `ReactivationEnrollment` so future runs are deterministic
- If the lead has **no thread** (no replies exist), we will:
  - set `ReactivationEnrollment.status = "needs_review"`
  - set `needsReviewReason` to an actionable remediation message:
    - `"No EmailBison thread/replies exist for this lead; cannot send reactivation via reply API. Enroll the lead in an EmailBison campaign to start a thread."`

### Persistence requirements (per outcome)

- On successful resolution (even if anchor is “any folder”):
  - `ReactivationEnrollment.emailBisonLeadId`
  - `ReactivationEnrollment.anchorReplyId`
  - `ReactivationEnrollment.anchorCampaignId` (nullable)
  - `ReactivationEnrollment.originalSenderEmailId` (nullable)
  - `ReactivationEnrollment.selectedSenderEmailId`
  - `ReactivationEnrollment.status = "ready"` and `nextActionAt = now`
- On send success:
  - `ReactivationSendLog` row for `stepKey="bump_1"` (dedupe)
  - `Message` outbound row for inbox visibility
- Best-effort “future reuse”:
  - Update `Lead.emailBisonLeadId` and `Lead.senderAccountId` when discovered/selected
  - Update `Lead.ghlContactId` when GHL discovery succeeds

## Handoff (Filled)

Proceed to **54d** to implement:
- relaxed tiered anchor selection (sent→any) and no longer require `campaign_id` to send
- on-demand re-resolution in `processReactivationSendsDue()` when anchor fields are missing or stale
- regression tests around the pure selection logic (tiering + folder detection)
