# Phase 93e — Verification + Rollout (Founders Club Runbook)

## Focus
Validate the implementation end-to-end and document the operational steps to configure and verify Chris/Aaron routing in Founders Club (and reuse the same pattern for future teams).

## Inputs
* Phase 93a–93d outputs
* Test harness: `npm run test` (see `scripts/test-orchestrator.ts`)
* Build parity: `npm run build`

## Work

### 1. Automated checks

```bash
npm run lint    # 0 errors (warnings acceptable)
npm run test    # All tests pass, including new 93b signature tests
npm run build   # Success
```

### 2. Manual verification (ALL trigger types)

**Setup:**
- Create AI Personas: Chris and Aaron, each with display name + signature set
- Assign Chris persona to Campaign A, Aaron persona to Campaign B

**Test `setter_reply` (primary use case):**
1. Create "Chris Follow-Up" sequence:
   - Trigger: "On first manual email reply"
   - Persona: Chris
   - Template includes `{signature}`
2. Create "Aaron Follow-Up" sequence:
   - Trigger: "On first manual email reply"
   - Persona: Aaron
   - Template includes `{signature}`
3. For a lead in Campaign A: Send manual email → Chris Follow-Up starts
4. For a lead in Campaign B: Send manual email → Aaron Follow-Up starts
5. Verify `{signature}` renders correctly in sent messages

**Test `no_response` (Day 2/5/7 sequences):**
1. Create "Chris No Response" sequence:
   - Trigger: "No response (after 24h)"
   - Persona: Chris
2. Lead in Campaign A: Trigger outbound email → Chris No Response starts (not generic)

**Test `meeting_selected` (Post-Booking sequences):**
1. Create "Chris Post-Booking" sequence:
   - Trigger: "After meeting selected"
   - Persona: Chris
2. Book meeting for Lead in Campaign A → Chris Post-Booking starts

**Test legacy fallback:**
1. Remove all persona-specific sequences
2. Verify existing "ZRG Workflow V1" / "No Response" / "Post-Booking Qualification" still work via name-based fallback
3. Confirm no regressions in existing workspace behavior

### 3. Document runbook

Create `docs/notes/persona-routed-workflows.md`:

```markdown
# Persona-Routed Follow-Up Workflows

## Overview
Follow-up workflows can be bound to specific AI personas, so leads in different campaigns automatically receive the correct workflow with the correct signature.

## Setup Steps
1. Create AI Personas (Settings → AI Personas)
   - Set display name and signature for each persona
2. Assign personas to campaigns (Settings → Integrations → Campaign Assignment)
3. Create persona-bound workflows (Settings → Follow-Ups)
   - Select trigger type (setter_reply, no_response, meeting_selected)
   - Select persona binding
   - Use `{senderName}` and `{signature}` tokens in templates

## How Routing Works
1. When a trigger fires, the system queries for matching sequences
2. Priority: exact persona match > generic (no persona) > legacy name-based
3. The matched sequence's persona (or campaign/default fallback) provides `{senderName}` and `{signature}` values

## Troubleshooting
- **Wrong workflow starts:** Check campaign persona assignment
- **{signature} blocked:** Ensure persona has signature configured
- **No workflow starts:** Verify sequence is active and trigger matches
- **Legacy behavior:** If no persona-specific sequences exist, name-based fallback applies
```

## Validation (RED TEAM)

- [ ] `npm run lint` passes (0 errors)
- [ ] `npm run test` passes (all tests including 93b)
- [ ] `npm run build` succeeds
- [ ] `setter_reply` routing works for Chris/Aaron
- [ ] `no_response` routing works for personas
- [ ] `meeting_selected` routing works for personas
- [ ] Legacy fallback works when no persona sequences exist
- [ ] Runbook documented

## Output
* `npm run lint` completed with existing warnings (no errors).
* `npm run test` passed (including `{signature}` tests).
* `npm run build` succeeded; existing CSS optimization warnings noted.
* Runbook added: `docs/notes/founders-club-persona-workflows.md`.
* Manual verification steps are documented but not executed in this phase.

## Handoff
If desired after rollout, add observability:
* A lightweight admin debug panel showing which workflow would be selected for a lead (persona id + chosen sequence).
