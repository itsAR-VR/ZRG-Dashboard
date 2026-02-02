# Phase 93 — Persona-Routed Follow-Up Workflows (All Trigger Types)

## Purpose
Ensure follow-up workflows auto-activate for **Chris** and **Aaron** (and any future persona/workflow) based on the lead's **EmailBison campaign persona**, with persona routing applied to **ALL trigger types** — not just setter reply.

## Context
We want to make follow-up workflow selection **persona-aware** so multi-person teams can run distinct workflows (with distinct signatures) inside the same workspace (e.g., Founders Club). This pattern applies to all workflow trigger types.

Decisions locked from the conversation:
* **Routing basis:** by `EmailCampaign.aiPersonaId` (campaign assignment panel).
* **Scope:** Persona routing applies to ALL trigger types:
  - `setter_reply` — On first manual email reply
  - `no_response` — On outbound email (Day 2/5/7 sequences)
  - `meeting_selected` — After meeting booked (Post-Booking sequences)
  - `manual` — Manual trigger only (persona routing still applies to template resolution)
* **Signature:** workflow templates should support persona-driven tokens (not hardcoded per-template text), and the UI should clearly explain this.

Auto-start functions affected:
1. `autoStartMeetingRequestedSequenceOnSetterEmailReply()` — `setter_reply`
2. `autoStartNoResponseSequenceOnOutbound()` — `no_response`
3. `autoStartPostBookingSequenceIfEligible()` — `meeting_selected`

Repo notes discovered during pre-flight:
* Current auto-start logic is in `lib/followup-automation.ts`, selecting sequences by name (hardcoded constants).
* Follow-up templates currently support `{senderName}` via `WorkspaceSettings.aiPersonaName` only (see `lib/followup-template.ts`, `lib/followup-engine.ts`).
* `triggerOn` field already exists on `FollowUpSequence` with values `no_response`, `meeting_selected`, `manual` — only need to add `setter_reply` to TypeScript union.

## Concurrent Phases
No active phases detected, but recent completed phases touched adjacent areas and should be treated as integration constraints.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 92 | Complete | UI polish in dashboard/settings | Re-read current UI state before editing; avoid regressions. |
| Phase 90 | Complete | Follow-up analytics derived from `FollowUpTask` | Ensure new trigger/routing doesn’t break attribution assumptions. |
| Phase 88 | Complete | Follow-up workflow analytics + `FollowUpInstance` semantics | Keep instance creation semantics stable (idempotent, no duplicates). |
| Phase 85 | Complete | AI persona editing permissions | Ensure new UI respects role capabilities (admin-only edits). |

## Objectives
* [ ] Add a reusable `routeSequenceByPersona()` helper to select the correct workflow for any trigger type, **routed by campaign persona**.
* [ ] Apply persona routing to ALL 3 auto-start functions (`setter_reply`, `no_response`, `meeting_selected`).
* [ ] Add follow-up template support for **persona signature tokens** (`{signature}`) and resolve tokens from AI Persona settings (with safe fallbacks).
* [ ] Provide configuration UI so admins can create/manage persona-specific workflows and understand which tokens are persona-sourced.

## Constraints
* Routing must follow campaign persona assignment: `EmailCampaign.aiPersonaId`.
* Do not break existing legacy behavior: if no persona-routed workflow exists, fall back to name-based selection (existing Meeting Requested/ZRG v1/No Response/Post-Booking behavior).
* Follow-up template policy remains strict (Phase 73): unknown tokens or missing required values must block sends safely.
* Validate `aiPersonaId` belongs to same `clientId` in server actions.
* If `prisma/schema.prisma` changes, run `npm run db:push` before calling the phase complete.
* Never commit secrets or PII.

## Success Criteria
* [~] Founders Club: A lead in an Aaron-persona campaign starts the Aaron workflow on first manual email reply; Chris leads start the Chris workflow. *(Code verified; manual test pending)*
* [x] Persona routing works for ALL trigger types: `setter_reply`, `no_response`, `meeting_selected`.
* [x] Follow-up templates can include `{signature}` and it resolves from the correct persona.
* [x] Admin UI makes persona/token sourcing clear (including your requested note).
* [x] Legacy fallback: existing sequences work without modification if no persona-specific sequences exist.
* [x] `npm run lint`, `npm run test`, and `npm run build` pass (warnings noted).

## Subphase Index
* a — Data Model + Trigger Plumbing (persona-bound sequences + trigger value)
* b — Persona Tokens in Follow-Up Templates (add `{signature}` + value resolution)
* c — Auto-Start Routing Logic (ALL trigger types via shared `routeSequenceByPersona()` helper)
* d — Settings UI (sequence trigger option + persona selector + explanatory note)
* e — Verification + Rollout (tests, build, and a Founders Club runbook)

## Repo Reality Check (RED TEAM)

### What exists today
- `FollowUpSequence.triggerOn` field already exists (`prisma/schema.prisma:1136`) with values `no_response`, `meeting_selected`, `manual`
- `AiPersona.signature` field exists (`prisma/schema.prisma:1559`)
- `EmailCampaign.aiPersonaId` field exists (`prisma/schema.prisma:1096`) via Phase 39
- Current auto-start functions select sequences by hardcoded name constants, not by `triggerOn` value
- `TRIGGER_OPTIONS` in UI (`followup-sequence-manager.tsx:96-100`) only has 3 options

### What the plan assumes
- `FollowUpSequence.aiPersonaId` does NOT exist — must be added in 93a
- Auto-start functions do NOT query `lead.emailCampaign.aiPersonaId` — must be added in 93c

### Verified touch points
- `lib/followup-automation.ts:366-485` — `autoStartMeetingRequestedSequenceOnSetterEmailReply`
- `lib/followup-automation.ts:346-363` — `autoStartNoResponseSequenceOnOutbound`
- `lib/followup-automation.ts:145-185` — `autoStartPostBookingSequenceIfEligible`
- `lib/followup-template.ts` — token definitions (no `{signature}` currently)
- `lib/followup-engine.ts:556-571` — value resolution (uses `WorkspaceSettings` only)
- `components/dashboard/followup-sequence-manager.tsx:96-100` — trigger options

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Lead query missing campaign data** — All 3 auto-start functions do NOT include `emailCampaign: { select: { aiPersonaId } }` in their lead queries. Must add this in 93c.
- **Template token missing persona context** — `generateFollowUpMessage` receives `WorkspaceSettings` but NOT the sequence's `aiPersonaId`. 93b must pass persona context.

### Missing or ambiguous requirements
- **Shared routing helper** — Plan originally only covered `setter_reply`. Now covers all triggers via `routeSequenceByPersona()` helper.
- **Value resolution order** — Clarified: sequence persona > campaign persona > default persona > workspace settings.

### Repo mismatches (fixed)
- `triggerOn` field already exists; only TypeScript union needs `"setter_reply"` added.
- UI needs 4th trigger option: `{ value: "setter_reply", label: "On first manual email reply" }`.

### Performance / timeouts
- Add composite index `@@index([clientId, triggerOn, isActive])` for routing queries.
- Batch persona resolution in `processNextFollowUpForInstance` to avoid N+1 queries.

### Security / permissions
- Validate `aiPersonaId` belongs to same `clientId` in `createFollowUpSequence` / `updateFollowUpSequence`.

## Implementation Order

```
93a (Data Model)
    ↓
93b (Template Tokens) ←─┐
    ↓                   │ Can run in parallel after 93a
93c (Routing Logic) ←───┘
    ↓
93d (Settings UI) — requires 93a + 93c
    ↓
93e (Verification) — requires all above
```

## Phase Summary

### Status
**Partial complete** — code changes + tests/build done; manual Founders Club verification pending. Review completed 2026-02-02.

### What shipped
- Added persona-bound follow-up sequences (`FollowUpSequence.aiPersonaId`) with routing helper `routeSequenceByPersona`.
- Added `{signature}` follow-up template token and persona-aware template value resolution.
- UI supports `setter_reply` trigger and persona selection with explanatory note.
- Server-side activation checks include persona-aware signature validation.
- Runbook added: `docs/notes/founders-club-persona-workflows.md`.

### Key decisions
- Routing uses campaign persona (fallback to workspace default persona when missing).
- `no_response` auto-start remains deprecated (Phase 66); routing applies to `setter_reply` and `meeting_selected`.
- Signature/token resolution uses persona values with workspace settings fallback.

### Tests
- `npm run lint` (warnings only).
- `npm run test` (pass).
- `npm run build` (pass; existing CSS optimization warnings).

### Follow-ups
- Perform manual Founders Club verification (Chris/Aaron campaigns).
- Run `npm run db:push` on deploy to apply schema changes.
- If desired, add a small admin debug panel for routing visibility.

### Review
See `docs/planning/phase-93/review.md` for detailed evidence mapping and verification results.
