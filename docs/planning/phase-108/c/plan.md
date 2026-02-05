# Phase 108c — Comparative Analysis + Synthesis (Setter vs AI; Booked vs Not)

## Focus
Generate actionable, outcome-linked insights from the dataset:
- What patterns correlate with booked meetings for **setters**?
- What patterns correlate with booked meetings for **AI**?
- What is being sent that isn’t converting, and how does it differ?

This is “insights campaign bot”-style synthesis, grounded in labeled cohorts.

## Inputs
- Phase 108b dataset extract (or persisted `InsightContextPack` artifact).
- Existing insights worker patterns:
  - thread extractor (`lib/insights-chat/thread-extractor.ts`)
  - pack synthesis (`lib/insights-chat/pack-synthesis.ts`)
  - question answering (`lib/insights-chat/chat-answer.ts`)

## Work
1. **Define the analysis outputs (minimum viable):**
   - Aggregate metrics: booking rate by sender type × channel × disposition (if available).
   - Qualitative patterns: common CTA shapes, question framing, concision, tone, timing cues.
   - “Anti-patterns”: recurring traits in non-booking messages.
2. **Use structured synthesis (avoid hand-wavy summaries):**
   - Create a strict JSON schema for the synthesis output:
     - top patterns (with evidence counts)
     - examples (redacted snippets or references)
     - recommended changes (prompts, guardrails, training targets)
     - confidence + caveats
3. **Bias and confounding controls:**
   - Separate by channel and by campaign mode where relevant.
   - Ensure balanced sampling (AI vs setter; booked vs not).
   - Track “time-to-booking” and ensure attribution window doesn’t leak post-booking content.
4. **Produce a “recommendation packet” per workspace:**
   - 3–10 concrete changes, each tied to evidence + expected impact.
   - Explicitly note which changes are safe for auto-send vs require human review.
5. **Verification:**
   - Snapshot-run reproducibility: same dataset inputs → same cohort counts.
   - Sanity check: known booked leads appear in the booked cohort, with attributed outbound pre-booking message.

## Output
- Structured synthesis stored on `InsightContextPack.synthesis` for Message Performance runs.
- Prompted synthesis implemented in `lib/message-performance-synthesis.ts` with JSON schema + PII-safe instructions.
- UI surfaces summary + recommendations in `components/dashboard/message-performance-panel.tsx`.

## Handoff
Phase 108d consumes the stored synthesis in the Insights UI, and Phase 108e uses eval/proposals to convert recommendations into human-reviewed changes.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added message performance synthesis prompt + schema (`lib/ai/prompt-registry.ts`, `lib/message-performance-synthesis.ts`).
  - Wired synthesis generation into report runs via `lib/message-performance-report.ts`.
  - Displayed synthesis summary + recommendations in the Message Performance panel.
- Commands run:
  - `rg -n "message_performance.synthesize" lib/ai/prompt-registry.ts` — verified prompt registration.
- Blockers:
  - None.
- Next concrete steps:
  - Hook eval loop to proposal generation (Phase 108h).
