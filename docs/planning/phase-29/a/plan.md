# Phase 29a — Message Classification (Initial Outbound vs Follow-Up Response)

## Focus
Create a deterministic classification system that tags each outbound message as either "initial outbound" (first contact) or "follow-up response" (reply to prospect message).

## Inputs
- Existing `Message` model with `direction` ("inbound" | "outbound") and `sentAt`
- Conversation threading via `leadId`
- `Lead.lastInboundAt` / `Lead.lastOutboundAt` timestamps

## Work

### Step 1: Define Response Type Enum
Add to a new shared module (recommended): `lib/insights-chat/message-response-type.ts`
```typescript
type MessageResponseType =
  | "initial_outbound"   // First outbound message OR outbound with no prior inbound
  | "follow_up_response" // Outbound message that follows an inbound message
  | "inbound"            // Prospect message
```

### Step 2: Classification Logic
Create `lib/insights-chat/message-classifier.ts`:

**Classification rules (deterministic, no AI):**
1. If `direction === "inbound"` → `"inbound"`
2. If `direction === "outbound"`:
   - Find all messages for this lead ordered by `sentAt`
   - If there are NO inbound messages before this outbound → `"initial_outbound"`
   - If there IS an inbound message before this outbound → `"follow_up_response"`

**Edge cases:**
- Automated sequence messages sent before any reply = `"initial_outbound"` (nurture drips)
- Agent replies after prospect engagement = `"follow_up_response"`
- Multiple outbounds after one inbound = `"follow_up_response"` (good enough for Phase 29)
  - Optional extension (future): split into `"follow_up_response"` (first outbound after an inbound) vs `"follow_up_touch"` (subsequent nudges)

### Step 3: Integrate with Thread Extractor
Modify transcript formatting so the extractor automatically benefits:
- Update `formatLeadTranscript()` in `lib/insights-chat/transcript.ts` to:
  - run the classifier over the already-sorted messages
  - annotate each transcript message header with `response_type=<...>`
  - (optional) emit a short label like `[FOLLOW-UP]` / `[INITIAL]` to make the signal obvious to the model

Keep this deterministic; do not involve LLM calls or heuristics beyond message sequence.

### Step 4: Validation
This repo currently has no test runner configured in `package.json`. Use one of:
- Add table-driven “fixtures” to the classifier module as `const EXAMPLES` and verify locally in a one-off Node script during development (no production dependency).
- Or (preferred if we want durable tests): introduce a minimal test runner (e.g. Vitest) in a separate phase and add proper unit tests then.

Suggested classification fixtures:
- Single outbound only → initial_outbound
- Outbound, outbound, outbound → all initial_outbound
- Outbound, inbound, outbound → initial, inbound, follow_up
- Inbound, outbound → inbound, follow_up (prospect contacted first)
- Outbound, inbound, outbound, inbound, outbound → initial, inbound, follow_up, inbound, follow_up

## Output

**Files created:**
- `lib/insights-chat/message-response-type.ts` — Type definition + human-readable labels
- `lib/insights-chat/message-classifier.ts` — Classification logic + validation fixtures

**Files modified:**
- `lib/insights-chat/transcript.ts` — Now returns `classifiedMessages` array and annotates transcript with `response_type=` and `[FOLLOW-UP]`/`[INITIAL]`/`[PROSPECT]` labels

**API:**
- `classifyMessageResponseType(messages, targetMessage)` — Classify a single message
- `classifyConversationMessages(messages)` — Classify all messages in a conversation (returns sorted array with `responseType` attached)
- `formatLeadTranscript()` now returns `{ header, transcript, lastMessages, classifiedMessages }`

**Transcript format change:**
```
[2024-01-01T10:00:00Z outbound email response_type=initial_outbound sentBy=agent [INITIAL]]
Hey, just reaching out...

[2024-01-02T14:30:00Z inbound email response_type=inbound [PROSPECT]]
Thanks for reaching out, I'm interested...

[2024-01-02T16:00:00Z outbound email response_type=follow_up_response sentBy=agent [FOLLOW-UP]]
Great to hear! Let me share some availability...
```

**Build verification:** `npm run build` passes.

## Handoff
Subphase b can now:
1. Access `classifiedMessages` from `formatLeadTranscript()` to count follow-up messages
2. Rely on `response_type=` annotations in the transcript for LLM analysis
3. Use the classification to compute follow-up effectiveness scores
