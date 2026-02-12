# Phase 143a — Core Detection Module + Prompt Registration

## Focus

Create `lib/action-signal-detector.ts` with two-tier detection (heuristic + AI disambiguation) and Slack notification. Register the `gpt-5-nano` prompt for Tier 2 disambiguation in the prompt registry.

## Inputs

- Existing patterns: `lib/notification-center.ts`, `lib/slack-bot.ts`, `lib/scheduling-link.ts`
- Prompt runner infrastructure: `lib/ai/prompt-runner/`, `lib/ai/prompt-registry.ts`
- `isPositiveSentiment()` from `lib/sentiment`
- `stripEmailQuotedSectionsForAutomation()` from `lib/email-cleaning.ts` (called upstream, result passed in as `strippedText`)

## Work

### 1. Define types in `lib/action-signal-detector.ts`

```typescript
export type ActionSignalType = "call_requested" | "book_on_external_calendar";
export type ActionSignal = { type: ActionSignalType; confidence: "high" | "medium"; evidence: string };
export type ActionSignalDetectionResult = { signals: ActionSignal[]; hasCallSignal: boolean; hasExternalCalendarSignal: boolean };
```

Export an `EMPTY_ACTION_SIGNAL_RESULT` constant for default/gated cases.

### 2. Tier 1: Heuristic call detection

`detectCallSignalHeuristic(strippedText, sentimentTag)` → `ActionSignal | null`
- `sentimentTag === "Call Requested"` → high confidence (sentiment already did AI work)
- 8 regex patterns on `strippedText` (body only, signatures stripped): "call me", "give me a ring/call/buzz", "can you call", "hop on a call", "prefer a call", "speak on the phone", "phone call/conversation", "reach me at (###)" → medium confidence
- No match → null

### 3. Tier 1: Heuristic external calendar detection

`detectExternalCalendarHeuristic(strippedText, workspaceBookingLink)` → `ActionSignal | null`
- `extractSchedulerLinkFromText(strippedText)` — link found IN body text (not signature)
  - If link ≠ workspace booking link → high confidence
  - If link = workspace link → null
- Phrase patterns on `strippedText`: "book on my/their calendar", "use my/their calendly", "here's my scheduling link", "book with my colleague/manager/director", "schedule with my colleague/manager" → medium confidence
- No match → null

### 4. Tier 2: AI disambiguation for signature links

`disambiguateSignatureSchedulerLink(opts)` → `Promise<{ intentional: boolean; evidence: string } | null>`

Only called when ALL of:
1. `extractSchedulerLinkFromText(fullText)` finds a link
2. `extractSchedulerLinkFromText(strippedText)` does NOT find that link (link is in signature)
3. `strippedText` contains scheduling language (pre-filter: /\b(book|schedule|calendar|meeting|call|availability|slot|time|discuss|connect)\b/i)

Uses `gpt-5-nano` via `runStructuredJsonPrompt`:
- Prompt: "Given this email reply and a scheduling link found in the sender's signature, determine if the sender is actively directing us to use this link for booking."
- Schema: `{ intentional: boolean, evidence: string }`
- Budget: min 100, max 300 tokens
- Reasoning effort: "minimal"
- Returns null on error (fail-safe)

### 5. Main detection function

`detectActionSignals(opts)` → `Promise<ActionSignalDetectionResult>`

Parameters: `{ strippedText, fullText, sentimentTag, workspaceBookingLink, clientId, leadId }`

Logic:
1. Gate: if `!isPositiveSentiment(sentimentTag)` → return EMPTY_ACTION_SIGNAL_RESULT
2. Run `detectCallSignalHeuristic(strippedText, sentimentTag)` → push if found
3. Run `detectExternalCalendarHeuristic(strippedText, workspaceBookingLink)` → push if found
4. If no external calendar signal from Tier 1:
   - Check Tier 2 conditions (link in full text, not in stripped, booking language present)
   - If all met → call `disambiguateSignatureSchedulerLink()`
   - If `intentional === true` → push high confidence signal with AI evidence
5. Return combined result

### 6. Notification function

`notifyActionSignals(opts)` → `Promise<void>`
- Parameters: `{ clientId, leadId, messageId, signals, latestInboundText }`
- Fetch client (slackBotToken), lead (name/email/phone), settings (slackAlerts, notificationSlackChannelIds)
- Guard: skip if slackAlerts off or no token/channels
- For each signal × channel: dedupe via NotificationSendLog (kind: "action_signal")
- Send rich Slack blocks: header with emoji, fields (lead, workspace, signal, confidence), snippet, phone, dashboard link

### 7. Register prompt in `lib/ai/prompt-registry.ts`

Add `action_signal.detect.v1`:
- Model: `gpt-5-nano`
- Reasoning: `"minimal"`
- API type: `"responses"`
- Budget: `{ min: 100, max: 300 }`
- Schema: `{ intentional: boolean, evidence: string }`
- System prompt: Concise instructions for signature link disambiguation

## Output

- `lib/action-signal-detector.ts` fully implemented
- `lib/ai/prompt-registry.ts` updated with new prompt
- All detection functions testable (Tier 1 is pure, Tier 2 has mockable AI call)

## Handoff

Provides `detectActionSignals`, `notifyActionSignals`, `ActionSignalDetectionResult`, and `EMPTY_ACTION_SIGNAL_RESULT` exports needed by phases 143b-143d for pipeline integration and draft context injection.
