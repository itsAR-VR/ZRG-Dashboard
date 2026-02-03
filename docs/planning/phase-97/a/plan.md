# Phase 97a — Evaluator Prompt + Output Semantics

## Focus
Make the auto-send evaluator less conservative about standard business qualification questions while preserving hard safety blockers. Ensure we interpret the model's structured JSON conservatively and consistently.

## Inputs
- Jam: evaluator flagged a revenue qualification question as "sensitive" and blocked auto-send.
- Current evaluator system prompt: `lib/ai/prompt-registry.ts:104-120` (`AUTO_SEND_EVALUATOR_SYSTEM`)
- Evaluator runtime: `lib/auto-send-evaluator.ts:26-210`
- Auto-send orchestrator + decision recording: `lib/auto-send/orchestrator.ts`, `lib/auto-send/record-auto-send-decision.ts`

## Work

### Step 1: Update `AUTO_SEND_EVALUATOR_SYSTEM` prompt (lib/ai/prompt-registry.ts:104-120)

**Current hard blockers (line 108-112):**
```
Hard blockers (always require human review, safe_to_send=false, confidence<=0.2):
- Any unsubscribe/opt-out/stop/remove language in the inbound reply or subject
- The inbound asks for specifics the draft cannot safely answer without missing context (pricing, exact details, attachments, etc.)
- The draft appears hallucinated, mismatched to the inbound, or references facts not in the transcript
- The draft asks for or reveals sensitive/personal data or credentials
```

**Replace with:**
```
Hard blockers (always require human review, safe_to_send=false, confidence<=0.2):
- Any unsubscribe/opt-out/stop/remove/blacklist language in the inbound reply or subject
- The inbound asks for specifics the draft cannot safely answer without missing context (exact pricing, contract terms, attachments, etc.)
- The draft appears hallucinated, mismatched to the inbound, or references facts not in the conversation
- The draft asks for or reveals credentials, passwords, banking/payment details, government IDs (SSN, passport, etc.), or medical records

SAFE to auto-send (do NOT treat as sensitive):
- Standard business qualification questions: revenue/ARR, headcount/team size, industry, company stage, budget range, timeline, decision-maker role
- Asking the lead for their availability or preferred meeting times
- Confirming or clarifying information already discussed in the conversation

Output consistency rule:
- If safe_to_send=true, then requires_human_review MUST be false
- If requires_human_review=true, then safe_to_send MUST be false
```

### Step 2: Tighten output interpretation (lib/auto-send-evaluator.ts:200-202)

**Current:**
```ts
const confidence = clamp01(Number(result.data.confidence));
const safeToSend = Boolean(result.data.safe_to_send) && confidence >= 0.01;
const requiresHumanReview = Boolean(result.data.requires_human_review) || !safeToSend;
```

**Replace with:**
```ts
const confidence = clamp01(Number(result.data.confidence));
// Treat contradictory JSON as unsafe (safety-first interpretation)
const safeToSend =
  result.data.safe_to_send === true &&
  result.data.requires_human_review === false &&
  confidence >= 0.01;
const requiresHumanReview = !safeToSend;
```

**Rationale:** If the model outputs `safe_to_send=true` but also `requires_human_review=true`, that's contradictory. The safety-first interpretation is to NOT auto-send. This prevents edge cases where the model is uncertain.

### Step 3: Verify orchestrator respects `safeToSend` (lib/auto-send/orchestrator.ts)

Confirm that `executeAutoSend` checks `evaluation.safeToSend` and only sends when true. No changes expected—just verification.

## Validation (RED TEAM)

1. **Unit test mock:** Create a test case where `evaluateAutoSend` is given JSON `{ safe_to_send: true, requires_human_review: true, confidence: 0.95, reason: "test" }`. Expect `safeToSend=false`.
2. **Build check:** `npm run build` passes.
3. **Lint check:** `npm run lint` passes.

## Output
- Updated evaluator prompt with explicit "SAFE to auto-send" guidance and consistency rule.
- Tightened output interpretation that treats contradictory JSON as unsafe.
- Clear behavior: qualification asks are allowed unless they cross into truly sensitive domains or mismatched context.

### Completed (2026-02-03)
- Updated `AUTO_SEND_EVALUATOR_SYSTEM` to explicitly allow standard B2B qualification questions (including revenue/headcount) and narrow “sensitive data” blockers to credentials/highly sensitive PII. (`lib/ai/prompt-registry.ts`)
- Implemented safety-first interpretation so auto-send only proceeds when `safe_to_send=true` **and** `requires_human_review=false`. Added `interpretAutoSendEvaluatorOutput(...)` helper for testability. (`lib/auto-send-evaluator.ts`)
- Verified: `executeAutoSend` gates sends on `evaluation.safeToSend` (no orchestrator changes required). (`lib/auto-send/orchestrator.ts`)

## Handoff
Proceed to Phase 97b to add warn-only UI indicators for campaigns whose naming implies AI but are still setter-managed.
