# Phase 62f — Integration: Wire Extraction into Inbound Pipeline + Testing

## Focus
Integrate qualification answer extraction into the inbound message processing pipeline and perform end-to-end testing of all three booking scenarios.

## Inputs
- Answer extraction module from 62b
- Booking routing logic from 62c
- Calendly API changes from 62d
- Settings UI from 62e
- Existing inbound pipeline in `lib/inbound-post-process/pipeline.ts`

## Work

### Wire Extraction into Inbound Pipeline
**File:** `lib/inbound-post-process/pipeline.ts`

Add answer extraction after sentiment classification:

```typescript
// In runInboundPostProcessPipeline(), after sentiment classification

// Extract qualification answers for positive sentiments
const positiveIntents = ["Interested", "Meeting Requested", "Call Requested", "Information Requested", "Meeting Booked"];
if (positiveIntents.includes(sentimentTag)) {
  pushStage("qualification_extraction");

  const shouldExtract = !lead.qualificationAnswers ||
    !lead.qualificationAnswersExtractedAt ||
    // Re-extract if conversation has new messages since last extraction
    new Date(lead.qualificationAnswersExtractedAt) < new Date(latestInboundMessage.sentAt);

  if (shouldExtract) {
    try {
      const extraction = await extractQualificationAnswers({
        leadId: lead.id,
        clientId,
        conversationTranscript: transcript,
        questions: await getWorkspaceQualificationQuestions(clientId),
      });

      if (extraction.success && extraction.answers.length > 0) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            qualificationAnswers: JSON.stringify(
              Object.fromEntries(extraction.answers.map(a => [a.questionId, a.answer]))
            ),
            qualificationAnswersExtractedAt: new Date(),
          },
        });
        console.log(prefix, `Extracted ${extraction.answers.length} qualification answers`);
      }
    } catch (error) {
      console.warn(prefix, "Failed to extract qualification answers:", error);
      // Non-blocking - booking can still proceed without answers
    }
  }
}
```

### Helper Function
**File:** `lib/qualification-answer-extraction.ts`

Add helper to get workspace questions:
```typescript
export async function getWorkspaceQualificationQuestions(
  clientId: string
): Promise<Array<{ id: string; question: string; required?: boolean }>> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { qualificationQuestions: true },
  });

  if (!settings?.qualificationQuestions) return [];

  try {
    return JSON.parse(settings.qualificationQuestions);
  } catch {
    return [];
  }
}
```

### End-to-End Testing

**Test Scenario 1: Lead with qualification answers**
1. Configure workspace with both Calendly links + qualification questions
2. Simulate email thread where lead answers questions:
   - "We're a SaaS company with 50 employees"
   - "Our biggest challenge is scaling sales"
3. Lead accepts offered time: "Let's do 3pm Thursday"
4. Verify:
   - Answers extracted and stored on Lead
   - Booking uses questions-enabled link
   - `questions_and_answers` passed to Calendly API

**Test Scenario 2: Lead without qualification answers**
1. Same workspace configuration
2. Lead immediately accepts time: "Yes, 3pm works"
3. Verify:
   - No answers extracted (nothing to extract)
   - Booking uses direct-book link
   - No `questions_and_answers` in API call

**Test Scenario 3: Lead proposes their own time**
1. Same workspace configuration
2. Lead proposes: "How about Tuesday at 10am?"
3. Verify:
   - `parseProposedTimesFromMessage()` extracts the time
   - Booking uses direct-book link
   - Meeting successfully booked

### Final Validation
- [ ] All three scenarios result in successful booking
- [ ] Answer extraction is non-blocking (failures don't break booking)
- [ ] Logging provides visibility into extraction results
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm run db:push` completes (if any final schema tweaks)

## Output
- Fully integrated qualification answer extraction in inbound pipeline
- End-to-end tested booking flow for all three scenarios
- Ready for production deployment

## Handoff
Phase 62 is complete. Document any follow-up items in the Phase Summary section of the root plan.

### Potential Follow-ups
- Add UI indicator showing which questions the lead has answered
- Add manual answer editing capability in CRM view
- Add analytics on answer extraction success rate
- Support for GHL custom fields (if they have an equivalent to Calendly questions)
