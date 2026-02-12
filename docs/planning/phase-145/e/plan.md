# Phase 145e — Phase Skill Workflow Hardening (Codex + Claude)

## Focus

Make AI behavior validation a mandatory part of planning/review skills for any change touching draft generation, messages, booking intent/routing, or overseer paths.

## Inputs

- `docs/planning/phase-145/d/plan.md`
- Skill files:
  - `/Users/AR180/.codex/skills/phase-review/SKILL.md`
  - `/Users/AR180/.codex/skills/phase-gaps/SKILL.md`
  - `/Users/AR180/.codex/skills/terminus-maximus/SKILL.md`
  - Claude-side mirrors (including Terminus Maximus parity location)

## Work

1. Update `phase-review` requirements:
  - detect if changed files touch AI messaging/booking paths,
  - require dual-track replay evidence,
  - require critical-case pass and non-critical >=90% pass before phase closure.
2. Update `phase-gaps` to flag missing AI validation steps as high-severity planning gaps.
3. Update `terminus-maximus` loop checklist to include dual-track replay gate before declaring completion.
4. Ensure Claude-side skill parity includes Terminus Maximus and same gate rules.
5. Update AGENTS/CLAUDE docs references so agents know this gate is mandatory long-term.

## Edge Cases

- Phase touches AI code indirectly (shared utilities) but no explicit prompt edits.
- Replay blocked by infra; review should mark blocked status explicitly and not misreport pass.
- Multi-agent concurrent edits touching same AI files.

## Validation

- Confirm skill files include explicit command/evidence requirements.
- Confirm no skill contradictions (Plan mode vs Default mode behavior unaffected).
- Confirm docs point to the right critical-case set and thresholds.

## Output

- Long-term agent workflow enforces AI behavior testing consistently across coding/review/testing agents.

## Handoff

145f executes final verification packet and phase closure recommendation.

## Progress This Turn (Terminus Maximus)

- Updated long-term agent workflow docs in-repo:
  - `AGENTS.md` replay section now includes manifest-driven replay command and artifact diagnostic expectations (`judgePromptKey`, `judgeSystemPrompt`, `failureType`).
  - `CLAUDE.md` mirror section updated with the same requirements.
- Updated Codex skill gates:
  - `/Users/AR180/.codex/skills/phase-review/SKILL.md`
  - `/Users/AR180/.codex/skills/phase-gaps/SKILL.md`
  - `/Users/AR180/.codex/skills/terminus-maximus/SKILL.md`
  - Added manifest-first NTTAN command patterns and required artifact evidence fields.
- Synced Claude-side parity by copying updated skills to:
  - `/Users/AR180/.claude/skills/phase-review/SKILL.md`
  - `/Users/AR180/.claude/skills/phase-gaps/SKILL.md`
  - `/Users/AR180/.claude/skills/terminus-maximus/SKILL.md`
- Verified parity via matching checksums between Codex and Claude copies.
