# Phase 10a — Audit Current “Not Ready” Handling + Failure Cases

## Focus
Locate the exact point(s) where “not ready” replies turn into “unqualified” outcomes, and compile a small set of real-world examples to drive prompt edits.

## Inputs
- Slack feedback: “not ready to sell” is being treated as unqualified; “not looking to sell” should be unqualified.
- Current prompt surfaces:
  - Sentiment classification prompt (`lib/ai/prompt-registry.ts`, `SENTIMENT_SYSTEM`)
  - Draft generation strategy (`lib/ai-drafts.ts`, `getResponseStrategy`, draft prompt builders)
  - Any UI/automation paths that set `lead.status = "unqualified"`
- AI Observability (prompt logs + classifications) for recent misfires

## Work
1. Inventory the classification + draft generation touchpoints in the codebase (SMS/email/LinkedIn).
2. Build a small regression set of “not ready” vs “not looking” replies with desired outcomes.
3. Identify why deferrals currently fall into “Not Interested” (and why that cascades into “unqualified” handling in human workflow).
4. Identify the minimal code/prompt changes to:
   - classify “not now” as `Follow Up`
   - classify “never / don’t want to sell / not looking to sell” as `Not Interested`
   - generate a draft for `Follow Up` that asks timeline + permission to check back (no meeting push)

## Output
- **Regression examples:** `docs/planning/phase-10/examples.md`
- **Where the issue is happening (key touchpoints):**
  - Sentiment classification prompt: `lib/ai/prompt-registry.ts` (`SENTIMENT_SYSTEM`, used by `sentiment.classify.v1`)
  - Email “inbox analyze” prompt + schema: `lib/ai/prompt-registry.ts` (`EMAIL_INBOX_MANAGER_ANALYZE_SYSTEM`) + `lib/sentiment.ts` (`analyzeInboundEmailReply` allowed categories + JSON schema) + `app/api/webhooks/email/route.ts` mapping
  - Draft-generation whitelist: `lib/ai-drafts.ts` (`shouldGenerateDraft`) — previously excluded `Follow Up` (fixed in this phase)
  - Draft-generation scheduling behavior: `lib/ai-drafts.ts` currently treats `Follow Up` as “should propose meeting times” (needs tweak so deferrals don’t get availability offered immediately)
- **Important note on “unqualified”:**
  - `unqualified` is a CRM status, not an AI sentiment tag. The AI doesn’t automatically set `lead.status = "unqualified"` from sentiment. The failure mode is primarily misclassification + suboptimal draft guidance causing humans to mark leads unqualified.

## Handoff
Proceed to Phase 10b: update classification prompts/schemas so “not now” reliably lands in `Follow Up` (including email inbox analyze), while “not looking to sell” stays `Not Interested`.
