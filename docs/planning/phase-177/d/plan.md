# Phase 177d — Implement Call-Intent Disambiguation (soft-call vs callback) and prevent false Call Requested

## Focus
Prevent “soft call” scheduling language (call-as-meeting) from being treated as callback intent (Call Requested / Booking Process 4). Keep true callback-request behavior intact.

## Inputs
- Phase 177a: messageId `02b32302-a570-46f3-adf0-7889d31de062` + at least one callback-request control case.
- Phase 177b: where sentiment + booking-process outcomes are computed and how Process 4 is triggered.

## Work
- Implement an AI-based disambiguation step used only when needed (ex: when sentiment/routing indicates callback/call-request):
  - If the message intent is “schedule a call/meeting next week” -> treat as meeting scheduling (normal pipeline).
  - If the message intent is “please call me back” / callback request -> preserve Call Requested / Process 4 behavior.
- Ensure downstream side-effects follow the corrected intent:
  - no call-request-only tasks/notifications for schedule-call intent,
  - no regression for explicit callback requests.

Concrete starting points (repo reality):
- Booking-process routing is computed in `lib/action-signal-detector.ts`; Process 4 currently correlates with `hasCallSignal=true` and/or `sentimentTag='Call Requested'`.
- Sentiment classification prompts live under `lib/sentiment.ts` / `sentiment.*` prompt keys in `lib/ai/prompt-registry.ts` (Phase 177b will confirm the exact entry point for email inbox analyze vs generic classify).

## Output
- Code changes for call-intent disambiguation.
- Updated notes in phase docs linking the change to leadId `29c19fe2-8142-45f5-9f3e-795de1ae13b1` (soft scheduled-call) and leadId `370b29c7-3370-4bfc-824b-5c4b7172d72a` (process 5 external scheduler case).

## Handoff
Phase 177e will add tests/replay coverage and run NTTAN gates.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated booking-process router prompt to treat Process 4 as callback-only (not scheduled-call language like “open to a quick call next week”):
    - `lib/ai/prompt-registry.ts` (`action_signal.route_booking_process.v1`)
    - `lib/action-signal-detector.ts` (system fallback constant)
  - Updated sentiment prompts to classify scheduled-call intent as “Meeting Requested” and reserve “Call Requested” for callback intent:
    - `lib/ai/prompt-registry.ts` (`sentiment.email_inbox_analyze.v1` system)
    - `lib/sentiment.ts` (fallback system text)
    - `lib/ai/prompts/sentiment-classify-v1.ts` (generic `sentiment.classify.v1` system)
- Commands run:
  - None (prompt text edits only).
- Blockers:
  - None.
- Next concrete steps:
  - Run NTTAN replay on the manifest cases to confirm routing + sentiment outcomes (Phase 177e).
