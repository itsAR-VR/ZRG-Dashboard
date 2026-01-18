# Phase 33b — AI Scoring Engine

## Focus

Build the AI logic that analyzes conversation context and outputs fit + intent scores on the 1-4 scale with reasoning.

## Inputs

- Schema from subphase a with `fitScore`, `intentScore`, `overallScore`, `scoreReasoning`, `scoredAt` fields + `WorkspaceSettings.idealCustomerProfile`
- Existing AI infrastructure: `lib/ai/prompt-registry.ts`, OpenAI integration
- Existing sentiment analysis patterns in `lib/sentiment.ts`

## Work

1. **Create scoring prompt in prompt registry:**
   - Key: `lead_scoring.score.v1`
   - Model: `gpt-5-nano` (cost control)
   - Input: Conversation history + workspace context (service description, qualification questions, AI personality settings incl. ICP) + lead metadata (EmailBison + GHL stored fields)
   - Output: Strict structured JSON with `fitScore`, `intentScore`, `overallScore`, `reasoning`

2. **Define scoring criteria in prompt:**

   **Fit Assessment (Is this person a match for the client?):**
   - 1: Clearly not a fit (wrong industry, wrong role, explicitly disqualified)
   - 2: Uncertain fit (limited information, ambiguous signals)
   - 3: Good fit (matches ICP, relevant need/role)
   - 4: Ideal fit (perfect match, high-value prospect)

   **Intent Assessment (How ready are they to act?):**
   - 1: No intent (unresponsive, explicit rejection)
   - 2: Low intent (engaged but noncommittal, exploring)
   - 3: Moderate intent (interested, asking questions, considering)
   - 4: High intent (ready to book, asking for next steps, urgency)

   **Overall Score Logic:**
   - Overall score must be a *combination* of fit + intent (model outputs it directly).
   - Keep the above mapping as a guideline, but allow the model to choose the best overall score based on full context.

3. **Create lib/lead-scoring.ts:**
   ```typescript
   export interface LeadScore {
     fitScore: number;      // 0-4 (0 = Blacklist/opt-out)
     intentScore: number;   // 0-4 (0 = Blacklist/opt-out)
     overallScore: number;  // 0-4 (0 = Blacklist/opt-out)
     reasoning: string;
   }

   export async function scoreLeadFromConversation(
     messages: Message[],
     clientContext?: { industry?: string; icp?: string }
   ): Promise<LeadScore>
   ```
   - `reasoning` is stored internally (`Lead.scoreReasoning`) and is not shown in the UI.

4. **Handle edge cases:**
   - No messages yet: Return null scores (don't guess)
   - Single outbound message: Return null (need response to score)
   - Lead is Blacklist/opt-out: Do not call AI; set `overallScore=1` deterministically (fit/intent can be `1` for consistency)
   - Consider conversation length and recency in scoring

5. **Add AI interaction logging** for cost tracking

## Output

**Completed 2026-01-17:**

1. Created `lib/lead-scoring.ts` with:
   - `LeadScore` interface (fitScore, intentScore, overallScore, reasoning)
   - `isLeadDisqualified()` - checks sentiment tag for Blacklist/opt-out
   - `scoreLeadFromConversation()` - AI scoring using gpt-5-nano with strict JSON schema
   - `scoreLead()` - full pipeline that fetches messages, context, and updates the Lead

2. Added prompt template `lead_scoring.score.v1` to `lib/ai/prompt-registry.ts` (lines 895-946):
   - Model: gpt-5-nano
   - Strict JSON schema output with fitScore, intentScore, overallScore (1-4)
   - Scoring criteria for fit (ICP match) and intent (readiness)

3. Features:
   - Handles disqualified leads (Blacklist/opt-out) by setting overallScore=1 without AI call
   - Uses workspace context (ICP, service description, qualification questions)
   - Uses lead metadata (company, industry, headcount)
   - Truncates long transcripts to 24k chars
   - Retries on transient failures
   - AI interaction logging via `runResponseWithInteraction`

## Handoff

AI scoring engine is ready. Subphase c will integrate `scoreLead()` into the background job pipeline to automatically score leads on new inbound messages.
