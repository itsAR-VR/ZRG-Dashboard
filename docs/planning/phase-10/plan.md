# Phase 10 — Refine “Not Ready” vs “Not Looking” Prompting

## Purpose
Improve AI prompting so leads who are **not ready to sell** aren’t treated as **unqualified**, and instead we capture a timeline + keep them in a nurture/follow-up path.

## Context
We’re seeing a pattern where leads get marked “unqualified” when their true intent is “not now” (timing issue), not “never” (hard decline). This hurts booking rates and removes people who may be open to selling later. We want a lightweight prompt adjustment that:
- Separates **hard no / not looking to sell** from **not ready / not right now**
- Encourages a simple, low-friction **timeline** question when appropriate
- Avoids adding new categories or changing the existing output schema unless necessary

## Objectives
* [x] Identify where “not ready” is being interpreted as “unqualified”
* [x] Make minimal prompt edits to classify deferrals as follow-up/nurture (not hard decline)
* [x] Enable draft generation for “Follow Up” so deferrals get a suggested reply
* [x] Add a simple timeline question pattern to replies when the lead indicates “not now”
* [x] Validate changes with real examples and basic regression cases

## Constraints
- Keep prompt changes minimal (no major rewrites, no new complicated taxonomy).
- Preserve existing structured outputs (sentiment categories, draft formatting constraints).
- Do not send/encourage replies to opt-outs or “Blacklist” conditions.
- SMS responses must remain concise (current <160 char goal).

## Success Criteria
- [ ] Deferral language (e.g., “not right now”, “maybe next year”, “not ready to sell yet”) consistently classifies as follow-up/nurture rather than hard decline. *(Needs 24–72h monitoring in AI Observability.)*
- [x] Reply drafts for deferrals consistently ask for a timeline (and permission to check back) without pushing a meeting.
- [ ] “Unqualified” usage is limited to explicit “don’t want to sell / not looking to sell” responses (or other true disqualifiers). *(Human workflow + monitoring.)*

## Subphase Index
* a — Audit current “not ready” handling + failure cases
* b — Minimal sentiment prompt edits for “not now” vs “never”
* c — Minimal reply prompt edits to ask for timeline on deferrals
* d — Validate with examples + monitor impact

## Phase Summary
- Added a lightweight regression set for “not ready” vs “not looking”: `docs/planning/phase-10/examples.md`
- Updated classification prompts/schemas so timing deferrals can be tagged as `Follow Up` (including the email inbox-analyze path)
- Enabled `Follow Up` draft generation and adjusted the draft strategy to ask for a timeline + permission to check back (and stopped auto-offering availability for `Follow Up`)
- Validation: `npm run lint` (warnings only) and `npm run build` succeeded
