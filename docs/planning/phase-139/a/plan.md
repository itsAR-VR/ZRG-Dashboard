# Phase 139a — Conversation-Aware Timezone Extraction

## Focus

Add the ability to detect a lead's timezone from conversation content. Currently `ensureLeadTimezone()` only uses metadata (companyState, phone, email). This subphase adds a conversation-scanning tier using regex (free) + AI fallback (gpt-5-nano, ~$0.0001).

This is the foundation for all other timezone fixes.

## Inputs

- `lib/timezone-inference.ts` — current 4-tier timezone inference
- Bug reports: lead says "PST", "Dubai", "Miami" and system ignores it
- Existing `runStructuredJsonPrompt` pattern from the metadata-based AI tier

## Work

### 1. Export `isValidIanaTimezone` (currently private)

Other files need this utility. Export it.

### 2. Add timezone abbreviation → IANA mapping table

```typescript
const TZ_ABBREVIATION_MAP: Record<string, { iana: string; confidence: number }> = {
  PST: { iana: "America/Los_Angeles", confidence: 0.97 },
  PDT: { iana: "America/Los_Angeles", confidence: 0.97 },
  MST: { iana: "America/Denver", confidence: 0.97 },
  MDT: { iana: "America/Denver", confidence: 0.97 },
  CST: { iana: "America/Chicago", confidence: 0.97 },
  CDT: { iana: "America/Chicago", confidence: 0.97 },
  EST: { iana: "America/New_York", confidence: 0.97 },
  EDT: { iana: "America/New_York", confidence: 0.97 },
  GMT: { iana: "Europe/London", confidence: 0.97 },
  UTC: { iana: "UTC", confidence: 0.97 },
  GST: { iana: "Asia/Dubai", confidence: 0.90 },
  AST: { iana: "America/Halifax", confidence: 0.80 },
  HST: { iana: "Pacific/Honolulu", confidence: 0.97 },
  AKST: { iana: "America/Anchorage", confidence: 0.97 },
  AKDT: { iana: "America/Anchorage", confidence: 0.97 },
  IST: { iana: "Asia/Kolkata", confidence: 0.80 },
  BST: { iana: "Europe/London", confidence: 0.90 },
  CET: { iana: "Europe/Paris", confidence: 0.90 },
  CEST: { iana: "Europe/Paris", confidence: 0.90 },
  AEST: { iana: "Australia/Sydney", confidence: 0.90 },
  JST: { iana: "Asia/Tokyo", confidence: 0.97 },
  SGT: { iana: "Asia/Singapore", confidence: 0.97 },
  HKT: { iana: "Asia/Hong_Kong", confidence: 0.97 },
  // Add more as needed
};
```

Ambiguous abbreviations (IST, AST, BST, GST) get lower confidence (0.80–0.90) so they don't override an existing lead timezone unless explicitly stated.

### 3. Add `extractTimezoneFromConversation` function

```typescript
export async function extractTimezoneFromConversation(opts: {
  messageText: string;
  clientId: string;
  leadId: string;
}): Promise<{
  timezone: string | null;
  confidence: number;
  source: "regex" | "ai_conversation";
} | null>
```

**Tier A — Regex extraction (free, instant):**
- Match tz abbreviations near time patterns: `/(\d{1,2}(:\d{2})?\s*(am|pm)?\s*)(PST|EST|CST|MST|PDT|EDT|...)\b/i`
- Also match standalone near scheduling context: `/\b(PST|EST|...)\s*(time)?\b/i` when message also contains scheduling keywords
- Look up in `TZ_ABBREVIATION_MAP`
- If multiple matches, take the last one (closer to scheduling context)

**Tier B — AI inference (only if Tier A finds nothing):**
- `runStructuredJsonPrompt` with `gpt-5-nano`, `reasoningEffort: "low"`
- System: "Extract the timezone from city/location mentions in this message. Look for city names, country mentions, or location clues."
- Schema: `{ timezone: string | null, confidence: number }`
- Feature ID: `timezone.infer_from_conversation`, prompt key: `timezone.infer_from_conversation.v1`
- Same budget as existing `timezone.infer.v1`

### 4. Modify `ensureLeadTimezone` signature (backward-compatible)

```typescript
export async function ensureLeadTimezone(
  leadId: string,
  opts?: { conversationText?: string | null }
): Promise<{
  timezone: string | null;
  source: "existing" | "deterministic" | "conversation" | "ai" | "workspace_fallback";
  confidence?: number;
}>
```

Insert conversation tier between existing-timezone check and AI-metadata inference:
- If `opts?.conversationText` is provided and no tz yet resolved
- Call `extractTimezoneFromConversation`
- If confidence >= 0.95, persist to `lead.timezone` and return

Repo reality note: current order in `ensureLeadTimezone` is known-region deterministic -> existing lead timezone -> US state deterministic -> AI metadata -> workspace fallback. Keep that order and insert conversation extraction after existing timezone check and before AI metadata inference.

### 5. Callsite compatibility audit

After signature update, run a callsite scan for `ensureLeadTimezone(` and confirm:

- existing callers compile unchanged because `opts` is optional
- only high-value inbound conversational paths pass `conversationText` in this phase (`lib/ai-drafts.ts`, `lib/followup-engine.ts`, `lib/background-jobs/sms-inbound-post-process.ts`)

### 6. Verify

- `extractTimezoneFromConversation({ messageText: "I'm free before noon PST" })` → `{ timezone: "America/Los_Angeles", confidence: 0.97, source: "regex" }`
- `extractTimezoneFromConversation({ messageText: "mostly in Miami now" })` → (Tier B AI) `{ timezone: "America/New_York", confidence: ~0.95, source: "ai_conversation" }`
- `ensureLeadTimezone(id, { conversationText: "11am PST works" })` → persists "America/Los_Angeles" to lead

## Output

- `lib/timezone-inference.ts` updated with:
  - Exported `isValidIanaTimezone`
  - `TZ_ABBREVIATION_MAP` const
  - `extractTimezoneFromConversation()` function
  - Modified `ensureLeadTimezone()` with optional `conversationText` parameter and new `"conversation"` source

## Handoff

Phase 139b needs the updated `ensureLeadTimezone` signature to pass `conversationText` from the trigger message in `generateResponseDraft()`. Phase 139c needs `isValidIanaTimezone` export for the business-hours filter.
