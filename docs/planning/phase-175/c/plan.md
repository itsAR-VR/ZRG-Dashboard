# Phase 175c — Not Interested Deferral Gate (Soft Deferral vs Hard No)

## Focus
Avoid sending timing-clarification prompts to leads who have expressed a hard “no,” while still supporting “not now / maybe later” deferrals that were classified as Not Interested.

## Inputs
* Current sentiment classification outputs (Follow Up vs Not Interested)
* Existing opt-out / do-not-contact detection and safety gate behavior
* Timing-clarification scheduler entry point (currently `scheduleFollowUpTimingFromInbound` in `lib/followup-timing.ts`)
* Inbound orchestration points:
  * `lib/inbound-post-process/pipeline.ts` (email)
  * `lib/background-jobs/sms-inbound-post-process.ts`
  * `lib/background-jobs/linkedin-inbound-post-process.ts`
  * `lib/background-jobs/email-inbound-post-process.ts`

## Work
1. Add a lightweight AI gate prompt (structured JSON):
* Prompt key: `followup.timing_reengage_gate.v1`
* Output:
  * `decision`: `deferral` or `hard_no` or `unclear`
  * `rationale`: short, operator-readable
* Policy:
  * `deferral` allows timing clarify and timing scheduling.
  * `hard_no` blocks timing clarify and scheduling.
  * `unclear` fails closed (no clarify), no Slack spam.
2. Integrate the gate into inbound processing:
* Today, timing scheduling is called only when sentiment is exactly `Follow Up`.
* Update inbound processors so that when sentiment is `Not Interested`:
  * run the gate on the inbound reply-only text, and
  * if `deferral`, call `scheduleFollowUpTimingFromInbound` (note: scheduler requires `sentimentTag: "Follow Up"` even though the stored lead sentiment remains `Not Interested`).
* Keep `Follow Up` path as-is (no gate needed).
3. Ensure hard-no path does not:
* create timing-clarifier tasks,
* create drafts,
* change lead to blacklisted.
4. Observability:
* Add a low-noise ops signal only for true anomalies:
  * gate prompt failure (unexpected), or
  * repeated ambiguous `unclear` results for the same lead (optional, but avoid Slack flood).

## Output
* Not Interested replies that are actually deferrals can get the clarify flow; true hard-nos do not.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented AI gate `followup.timing_reengage_gate.v1` as `runFollowUpTimingReengageGate(...)` in `lib/followup-timing.ts` (structured JSON; fail-closed to `unclear` on errors).
  - Integrated the gate into all inbound processors so `Not Interested` replies can still route into `scheduleFollowUpTimingFromInbound(...)` when the gate returns `deferral` (by passing `sentimentTag: "Follow Up"` to the scheduler without changing the stored lead sentiment).
  - Confirmed policy: `Objection` does not route through this gate and remains in objection-specific handling.
- Commands run:
  - Not run in this environment (per agent constraints; user did not request validation commands).
- Blockers:
  - None.
- Next concrete steps:
  - Add tests for gate behavior + cancel-on-inbound (Phase 175d).

## Handoff
Proceed to Phase 175d to add tests and run the NTTAN validation suite.
