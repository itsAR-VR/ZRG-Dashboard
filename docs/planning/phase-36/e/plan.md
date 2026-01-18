# Phase 36e — AI Draft Integration

## Focus

Modify the AI draft generation pipeline to inject booking process instructions based on the current reply stage for the lead/campaign/channel combination.

## Inputs

- Reply counter from phase 36b (`getReplyCount`)
- Campaign → BookingProcess assignment from phase 36d
- Existing AI draft generation: `lib/ai-drafts.ts`
- Existing prompt registry: `lib/ai/prompt-registry.ts`
- Existing availability/slots system: `lib/availability-*.ts`
- Qualifying questions from `WorkspaceSettings`

## Work

### 1. Create Booking Process Instruction Builder

Create `lib/booking-process-instructions.ts`:

```typescript
interface BookingProcessContext {
  leadId: string;
  campaignId: string;
  channel: 'email' | 'sms' | 'linkedin';
  workspaceSettings: WorkspaceSettings;
  calendarLink: string;
  availableSlots?: string[];  // If suggesting times
}

export async function getBookingProcessInstructions(
  context: BookingProcessContext
): Promise<string | null> {
  // 1. Get the booking process for this campaign
  const campaign = await prisma.emailCampaign.findUnique({
    where: { id: context.campaignId },
    include: { bookingProcess: { include: { stages: true } } }
  });

  if (!campaign?.bookingProcess) {
    return null; // No booking process, use default behavior
  }

  // 2. Get current reply count for this lead/campaign/channel
  const replyCount = await getReplyCount({
    leadId: context.leadId,
    campaignId: context.campaignId,
    channel: context.channel,
  });

  // Reply count is 0 before first send, so stage 1 = replyCount 0
  const stageNumber = replyCount + 1;

  // 3. Find the applicable stage
  const stage = campaign.bookingProcess.stages.find(
    s => s.stageNumber === stageNumber
  );

  // If no stage defined for this reply number, use last stage or no instructions
  const effectiveStage = stage ?? campaign.bookingProcess.stages.at(-1);

  if (!effectiveStage) {
    return null;
  }

  // 4. Check if this stage applies to this channel
  const channelApplies = {
    email: effectiveStage.applyToEmail,
    sms: effectiveStage.applyToSms,
    linkedin: effectiveStage.applyToLinkedin,
  }[context.channel];

  if (!channelApplies) {
    return null; // Stage doesn't apply to this channel
  }

  // 5. Build instruction string
  return buildStageInstructions(effectiveStage, context);
}

function buildStageInstructions(
  stage: BookingProcessStage,
  context: BookingProcessContext
): string {
  const instructions: string[] = [];

  if (stage.includeBookingLink) {
    const linkInstruction = stage.linkType === 'hyperlinked_text'
      ? `Include a booking link as hyperlinked text (e.g., "book a time here"). Link: ${context.calendarLink}`
      : `Include the booking link as a plain URL: ${context.calendarLink}`;
    instructions.push(linkInstruction);
  }

  if (stage.includeSuggestedTimes && context.availableSlots?.length) {
    const times = context.availableSlots.slice(0, stage.numberOfTimesToSuggest);
    instructions.push(
      `Suggest ${stage.numberOfTimesToSuggest} specific times for a call. Use these available slots: ${times.join(', ')}`
    );
  }

  if (stage.includeQualifyingQuestions && stage.qualifyingQuestionIds.length) {
    const questions = getQualifyingQuestions(
      context.workspaceSettings,
      stage.qualifyingQuestionIds
    );
    if (questions.length) {
      instructions.push(
        `Ask the following qualifying question(s): ${questions.join(' ')}`
      );
    }
  }

  if (stage.includeTimezoneAsk) {
    instructions.push(`Ask what timezone the lead is in to confirm meeting times.`);
  }

  if (instructions.length === 0) {
    return ''; // No specific booking instructions for this stage
  }

  return `\n\nBOOKING INSTRUCTIONS FOR THIS REPLY:\n${instructions.map(i => `- ${i}`).join('\n')}`;
}
```

### 2. Integrate into AI Draft Generation

Modify `lib/ai-drafts.ts`:

```typescript
// In generateDraft or equivalent function:

async function generateDraft(params: DraftParams): Promise<string> {
  // ... existing context gathering ...

  // Get booking process instructions
  const bookingInstructions = await getBookingProcessInstructions({
    leadId: params.leadId,
    campaignId: params.campaignId,
    channel: params.channel,
    workspaceSettings: params.workspaceSettings,
    calendarLink: params.workspaceSettings.calendarLink,
    availableSlots: await getAvailableSlots(params.workspaceSettings),
  });

  // Inject into system prompt or user message
  const enhancedPrompt = bookingInstructions
    ? `${basePrompt}${bookingInstructions}`
    : basePrompt;

  // ... call OpenAI with enhanced prompt ...
}
```

### 3. Handle Slot Suggestion Integration

When stage includes suggested times:

1. Fetch available slots from `WorkspaceAvailabilityCache` or `getAvailableSlots`
2. Format slots in user-friendly format (e.g., "Tuesday, Jan 21 at 2:00 PM")
3. Include in prompt instructions
4. After draft is sent, store offered slots in `Lead.offeredSlots` (existing field)

### 4. Handle Qualifying Questions

```typescript
function getQualifyingQuestions(
  settings: WorkspaceSettings,
  questionIds: string[]
): string[] {
  const allQuestions = settings.qualifyingQuestions as Array<{
    id: string;
    text: string;
  }> ?? [];

  return questionIds
    .map(id => allQuestions.find(q => q.id === id)?.text)
    .filter(Boolean) as string[];
}
```

### 5. Prompt Template Updates

Add booking process section to prompt templates in `lib/ai/prompt-registry.ts`:

```typescript
// Example prompt enhancement
const BOOKING_AWARE_REPLY_PROMPT = `
You are a sales assistant replying to a lead.

{existing_context}

{booking_instructions}

Important: Follow the booking instructions exactly. If told to suggest times, suggest those specific times. If told to include a booking link, include it in the specified format.
`;
```

### 6. Escalation Check

When reply count exceeds `maxRepliesBeforeEscalation`:

```typescript
if (replyCount >= bookingProcess.maxRepliesBeforeEscalation) {
  // Flag for human review instead of generating draft
  await flagForEscalation(leadId, campaignId, 'max_booking_attempts_exceeded');
  return { requiresHumanReview: true, reason: 'Max booking attempts reached' };
}
```

### 7. Override Handling

If lead clearly accepts at any stage (before booking link was offered):
- Existing `processMessageForAutoBooking` handles this
- AI should recognize "yes, let's do Tuesday" even if current stage doesn't include booking link
- Add instruction: "If the lead clearly wants to book based on suggested times, confirm the booking immediately."

### 8. Testing Points

- Verify prompt includes booking instructions at correct stage
- Verify stage 1 fires on first reply (replyCount = 0)
- Verify channel filtering works (stage for email doesn't affect SMS)
- Verify last stage repeats if past defined stages
- Verify escalation triggers at threshold

## Output

- `lib/booking-process-instructions.ts` with instruction builder
- Updated `lib/ai-drafts.ts` to inject booking instructions
- Updated prompt templates with booking instruction placeholder
- Escalation handling for max attempts
- Integration with existing slot offering system

## Handoff

AI drafts now respect booking process stages. Subphase f will build analytics to track effectiveness of different booking processes.
