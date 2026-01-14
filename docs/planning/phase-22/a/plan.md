# Phase 22a — Repro + Evidence Bundle (Jam + Live App Observations)

## Focus
Establish a precise, repeatable repro and capture the key artifacts (UI state, server responses) needed to debug sentiment display and attention filters.

## Inputs
- Jam: `https://jam.dev/c/e5370b91-8f54-49b7-97d4-fcf7cca10b51` (screenshot, Jan 14 2026)

## Work
- Reproduce in the live app:
  - Open the affected workspace → Master Inbox.
  - Confirm at least one conversation shows sentiment `New` despite content indicating positive intent.
  - Check “Requires Attention” and “Previously Required Attention” tabs; confirm low counts vs expectation.
- Capture the relevant server calls/outputs (redacting identifiers):
  - The “counts” server action response (requiresAttention / previouslyRequiredAttention).
  - The conversations list fetch parameters and response (ensure it is not incorrectly returning `[]`).
- Record the minimal evidence needed for debugging without personal data:
  - Workspace id (internal UUID) and a small set of lead ids (UUIDs only), if needed.
  - Any “last analyzed”/rollup timestamps if present in the UI.

## Output
- A short repro checklist with:
  - Expected vs observed outcomes
  - The key server responses that disagree with expected behavior

## Handoff
Proceed to Phase 22b to validate ground truth in the DB for the same workspace/lead(s) and determine whether the issue is data or logic.

