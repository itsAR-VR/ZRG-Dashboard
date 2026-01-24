# Phase 54a — Audit Current Reactivation Flows + Anchor Contract

## Focus
Establish a precise, shared definition for “sent anchor” and document the current failure modes that block reactivation sends when `anchorReplyId` is missing.

## Inputs
- `docs/planning/phase-54/plan.md`
- `lib/reactivation-engine.ts` (`resolveReactivationEnrollmentsDue`, `processReactivationSendsDue`)
- `prisma/schema.prisma` (Reactivation models)
- Jam link (currently not accessible via Jam MCP in this environment)

## Work
- Trace current state machine:
  - How enrollments move from `pending_resolution` → `ready` → `sent` (or `needs_review` / `failed` / `rate_limited`).
  - Identify exactly where and why `needs_review` is set when no anchor is found.
- Define “anchor” contracts:
  - What fields are required to send an EmailBison reactivation today (`anchorReplyId`, `selectedSenderEmailId`, etc.).
  - Which provider artifact(s) qualify as “in-thread anchor” vs “sent anchor”.
  - Clarify “same thread vs new thread” expectations in terms of provider primitives.
- Create a minimal repro matrix (local/dev DB) and document expected outcomes:
  - Lead has email + EmailBison lead exists + has sent reply with campaign id
  - Lead has email + EmailBison lead exists + has replies but none in sent folder (or missing campaign id)
  - Lead has email + EmailBison lead exists + has no replies at all
  - Lead has email but EmailBison lead does not exist

## Output
- A written "anchor contract" and a list of concrete failure modes with the intended new behavior for each.

## Handoff
Use the failure-mode matrix + anchor definitions to design a deterministic discovery algorithm in **54b**.

## Validation (RED TEAM)

- [ ] Confirm `resolveReactivationEnrollmentsDue()` state transitions match documented behavior (read lib/reactivation-engine.ts:278-558)
- [ ] Verify `pickAnchorFromReplies()` (line 35) logic matches the "anchor contract" definition
- [ ] Document which `needs_review` reasons are true blockers vs recoverable-with-fallback

## Assumptions / Open Questions (RED TEAM)

- **Anchor definition** (confirmed): An anchor is a `reply_id` that can be passed to `sendEmailBisonReply()` to send an in-thread reply. Currently restricted to sent-folder replies with campaign_id.
  - Open question: Can inbox replies serve as anchors when no sent reply exists?

## Output (Filled)

### Current state machine (as implemented)

- `pending_resolution` → `ready` happens in `resolveReactivationEnrollmentsDue()` when we successfully:
  - discover `emailBisonLeadId`
  - fetch EmailBison replies
  - pick an anchor via `pickAnchorFromReplies()`
  - pick a sendable `selectedSenderEmailId` (original if sendable + allowed, else fallback)
- `pending_resolution` → `needs_review` happens when any of the above fails (missing EmailBison API key, no EmailBison lead_id, cannot fetch replies, or no anchor found).
- `ready`/`rate_limited` → `sent` happens in `processReactivationSendsDue()` after reserving daily sender usage and successfully calling `sendEmailBisonReply()`.
- `ready`/`rate_limited` → `needs_review` currently happens when `anchorReplyId` or `selectedSenderEmailId` is missing at send time (hard fail, no on-demand resolution).

### Anchor contract (updated definition for Phase 54)

**Provider primitive:** EmailBison reactivation sends are **reply-in-thread** only (`POST /api/replies/:id/reply`).

Therefore:
- **Thread anchor** = any EmailBison `reply.id` that the provider will accept as the reply target.
- **Sent anchor** = a thread anchor whose folder indicates the message was sent by us/outbound (preferred for context).
- `anchorCampaignId` is optional metadata (useful for debugging), but **not required** to send.
- `originalSenderEmailId` is optional (used to prefer the original sender); if missing/non-sendable, we can still send using a fallback sender.

**New-thread:** There is no EmailBison “send a new email thread” API wrapper in-repo; creation of an EmailBison lead (`POST /api/leads`) does not create a reply/thread. Phase 54 should treat “no replies exist” as a true blocker and leave an actionable `needs_review` reason.

### Failure-mode matrix + intended behavior changes

| Scenario | Current behavior | Intended behavior (Phase 54) |
|---|---|---|
| EmailBison lead_id missing but discoverable by email | Often recovers (search by email + global replies fallback) | Keep; add DB-first + better fallbacks in 54b |
| Replies exist but none match configured campaign_id | `needs_review` (anchor null) | Fall back to most recent sent reply (any campaign) |
| Replies exist but sent-folder messages missing `campaign_id` | `needs_review` (anchor null) | Fall back to sent-folder reply without campaign_id; keep `anchorCampaignId = null` |
| Replies exist but no sent-folder messages | `needs_review` | Fall back to newest reply in any folder (accept “in-thread but not sent” anchor) |
| Enrollment reaches send path with missing anchor fields | `needs_review` immediately | Re-resolve on-demand in `processReactivationSendsDue()` and proceed if an anchor exists |
| No replies exist at all (no thread) | `needs_review` | Still `needs_review`, but with a precise reason: “No EmailBison thread/replies exist for this lead; cannot send reactivation via reply API.” |

## Coordination Notes

- Jam MCP could not be loaded in this environment (`Auth required`), so the contract is derived from code paths and the described symptom.
- Working tree is currently dirty across multiple integration surfaces (EmailBison/GHL/reactivation). Phase 54 implementation must re-read and merge semantically with current file state before edits.

## Handoff (Filled)

Proceed to **54b** to design a deterministic “resolve anchor by email” algorithm that:
- prefers sent-folder anchors but has safe fallbacks to any-thread anchors
- avoids requiring `campaign_id` for sendability
- can be used both in batch resolution and on-demand during send
