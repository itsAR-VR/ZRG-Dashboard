# Phase 176a — Investigation + Policy Spec (Jam + Supabase-backed cases)

## Focus
Turn the reported notifications + Jam + Supabase examples into a precise failure taxonomy, then map each failure to a concrete code path we will change.

## Inputs
* Jam: `https://jam.dev/c/ef529046-ef5e-492d-a14c-0e13b660a453`
* Founders Club clientId: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
* Supabase example IDs:
  * Lead: `efd5727a-2287-4099-b2d8-05def2cf8921`
  * Inbound “reschedule with windows” message: `0920ae43-ecf2-4bdd-bdc3-4c08e4549dc9`
  * Outbound “offered out-of-window times” message: `bf9692eb-ff67-4764-8ba4-e5f6a8809c52`

## Work
1. Locate the notification emitters / routing decisions:
   - Find where `Follow-Up Timing Not Scheduled` and `AI Draft Skipped (Intentional Routing)` are generated and what conditions trigger them.
2. Confirm current behavior in code:
   - When meeting scheduler creates a FollowUpTask, does it skip `AIDraft` creation by design?
   - When follow-up timing extractor returns “no concrete date”, do we reliably create a clarifier draft across channels?
3. Gather additional Supabase-backed cases (IDs only):
   - Jeff Shilling (no concrete date, “2–3 years”).
   - Terra Mattson (objection + “maybe in the future”).
   - Lee Cohen / Sanjit Ghate (Meeting Requested but draft skipped).
4. Write down the precise policy contract this phase will enforce (for later prompts + invariants):
   - Window match => pick offered slot.
   - No window match => link-only (no alternatives).
   - Objection => objection-handling mode; do not ask for follow-up timing.

## Output
## Findings (grounded)
1. Slack alert `⚠️ Follow-Up Timing Not Scheduled` is emitted from `lib/followup-timing.ts` via `notifyTimingExtractionMissForOps(...)` when `scheduleFollowUpTimingFromInbound(...)` fails to create a follow-up task (or cannot clarify by call).
2. Slack alert `⚠️ AI Draft Routed (Intentional Routing)` is emitted from `lib/background-jobs/email-inbound-post-process.ts` via `notifyDraftSkipForOps(...)` when `schedulingHandled = (autoBook.context.followUpTaskCreated || timingFollowUpScheduled)` and the normal `generateResponseDraft(...)` path is intentionally skipped.
3. The “draft routed” skip assumes a pending inbox draft exists for any scheduling-created FollowUpTask. That assumption is false in existing production data:
   - Pending FollowUpTask rows exist without corresponding `AIDraft` rows for `triggerMessageId = followup_task:<taskId>`.

## Supabase-backed case IDs (no PII)
* Jeff Shilling:
  * leadId: `b136f715-5349-413b-889a-1ea5418fa0c1`
  * latest inbound messageId: `0294af0f-9e16-4fde-b1b5-a9506e927b9f`
* Terra Mattson:
  * leadId: `bfe9d20b-dd1b-4a38-b1f9-c7841ea8d5d5`
  * latest inbound messageId: `fbd7321b-212c-42e6-acc2-7470397ec643`
* Lee Cohen (Meeting Requested routing):
  * leadId: `719dea81-d406-4e81-a074-ccc04dcda00b`
  * latest inbound messageId: `5b0874d8-e9ba-4c6e-8e21-5babaee2fe11`
  * pending followUpTaskId (clarification): `c0895596-a812-4777-bdd7-bc0dee1ca29e`
  * verified missing draft: no `AIDraft.triggerMessageId = followup_task:c0895596-a812-4777-bdd7-bc0dee1ca29e`
* Sanjit Ghate (Meeting Requested routing):
  * leadId: `03f401f9-23d7-43f5-a0aa-45e50033b90a`
  * latest inbound messageId: `01697e14-d8b5-4487-a3c6-2d9776befca0`
  * pending followUpTaskId (clarification): `c583571f-c17d-4942-8127-4c3c8609cfb6`
  * verified missing draft: no `AIDraft.triggerMessageId = followup_task:c583571f-c17d-4942-8127-4c3c8609cfb6`
* Caleb Owen (reschedule windows ignored):
  * leadId: `efd5727a-2287-4099-b2d8-05def2cf8921`
  * inbound reschedule-with-windows messageId: `0920ae43-ecf2-4bdd-bdc3-4c08e4549dc9`
  * outbound out-of-window offer messageId: `bf9692eb-ff67-4764-8ba4-e5f6a8809c52`

## Policy contract (for later prompts + invariants)
* If the lead provides explicit scheduling windows:
  - choose an offered slot inside one of the windows, OR
  - reply link-only (“not available in that window yet/right now” + calendar link), and **do not** propose other times.
* Do not repeat previously offered slots.
* If the message is primarily an objection (competitor / already have X), route to objection handling (do not run follow-up timing clarify).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Located the Slack alert emitters for the two warning types.
  - Pulled Jam artifacts and Supabase-backed “bad case” IDs for replay/fixtures.
  - Confirmed a concrete gap: scheduling-created FollowUpTasks can exist without `AIDraft` rows, but inbound processors skip normal drafting under the assumption a draft exists.
- Commands run:
  - `rg -n "Follow-Up Timing Not Scheduled|no_concrete_date_detected|AI Draft Skipped|Intentional Routing" .` — pass (located emitters).
  - Supabase queries (Lead/Message/FollowUpTask/AIDraft) — pass (IDs gathered; draft-missing verified).
- Blockers:
  - None.
- Next concrete steps:
  - Implement “FollowUpTask => AIDraft” creation (and backfill/repair for existing pending tasks).
  - Enforce window mismatch => link-only in meeting scheduler + revision loop, using Caleb Owen case as fixture/replay.

## Handoff
Implement the policy in runtime drafting + revision loop and ensure drafts exist for these routed flows.
