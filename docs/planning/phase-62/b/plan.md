# Phase 62b — Answer Extraction: Create AI-Powered Extraction from Conversation

## Focus
Create a new module that uses AI to extract qualification question answers from conversation transcripts and store them on the Lead record.

## Inputs
- Schema from 62a: `Lead.qualificationAnswers` and `Lead.qualificationAnswersExtractedAt` fields
- `WorkspaceSettings.qualificationQuestions` JSON structure: `[{ id, question, required? }]`
- Existing prompt runner infrastructure in `lib/ai/`
- Conversation transcript building patterns from `lib/ai-drafts.ts`

## Work

### Create New Module
**File:** `lib/qualification-answer-extraction.ts`

```typescript
export interface QualificationAnswer {
  questionId: string;
  questionText: string;
  answer: string;
  confidence: number;  // 0-1
}

export interface ExtractionResult {
  success: boolean;
  answers: QualificationAnswer[];
  hasRequiredAnswers: boolean;  // True if all required questions answered
}

/**
 * Extract qualification answers from conversation transcript.
 * Uses AI to analyze the conversation and match responses to questions.
 */
export async function extractQualificationAnswers(params: {
  leadId: string;
  clientId: string;
  conversationTranscript: string;
  questions: Array<{ id: string; question: string; required?: boolean }>;
}): Promise<ExtractionResult>;

/**
 * Check if a lead has answered any qualification questions.
 */
export async function hasQualificationAnswers(leadId: string): Promise<boolean>;

/**
 * Get stored qualification answers for a lead, formatted for Calendly API.
 */
export async function getQualificationAnswersForBooking(leadId: string): Promise<
  Array<{ question: string; answer: string }> | null
>;
```

### AI Prompt Design
- System prompt: "Extract answers to qualification questions from the conversation. For each question, find the lead's response if present."
- Input: Conversation transcript + list of questions
- Output: JSON array of `{ questionId, answer, confidence }`
- Only extract answers with confidence >= 0.7

### Storage Logic
1. Parse AI response
2. Filter by confidence threshold
3. Store as JSON in `Lead.qualificationAnswers`
4. Update `Lead.qualificationAnswersExtractedAt`
5. Re-extraction triggered if conversation has new messages since last extraction

### Validation
- [ ] AI correctly extracts answers from sample conversations
- [ ] Low-confidence answers are filtered out
- [ ] Storage format matches expected JSON structure
- [ ] `npm run lint` passes

## Output
- New `lib/qualification-answer-extraction.ts` module
- Helper functions for checking/getting qualification answers

## Handoff
Answer extraction module is ready. Subphase 62c can now use `hasQualificationAnswers()` to determine booking link routing.
