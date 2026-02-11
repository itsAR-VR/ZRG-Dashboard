# Phase 139b — Date Context + Lead Timezone in AI Prompts

## Focus

Inject today's date context and the lead's detected timezone into all AI draft prompt builders. Without today's date, the AI cannot resolve "this Friday" vs "next Friday". Without the lead's timezone, the AI cannot interpret "before noon PST".

Also add deterministic timing-preference extraction to pre-filter slots by the lead's stated preference.

## Inputs

- 139a: Updated `ensureLeadTimezone` with `conversationText` parameter
- `lib/ai-drafts.ts` — prompt builders: `buildSmsPrompt`, `buildLinkedInPrompt`, `buildEmailPrompt`, `buildEmailDraftStrategyInstructions`
- `generateResponseDraft()` scheduling section where timezone is resolved and slots are selected
- Bug 3: "This Friday" booked as next week because AI has no date context

## Work

### 1. Add `buildDateContext` helper (`ai-drafts.ts`)

Near the top of the file (after imports):

```typescript
function buildDateContext(timeZone: string): string {
  const now = new Date();
  const dayFormat = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(now);
  const shortTz = tzParts.find(p => p.type === "timeZoneName")?.value || timeZone;
  return `Today is ${dayFormat.format(now)} (${shortTz}).`;
}
```

### 2. Thread `dateContext` and `leadTimezoneContext` into prompt builders

In `generateResponseDraft()` after timezone resolution:

```typescript
const workspaceTimeZone = settings?.timezone || "America/New_York";
const dateContext = buildDateContext(workspaceTimeZone);
const leadTimezoneContext = tzResult.timezone
  ? `Lead's timezone: ${tzResult.timezone}`
  : "Lead's timezone: unknown";
```

Pass `conversationText` to `ensureLeadTimezone`:
```typescript
const latestMessageBody = triggerMessageRecord?.body || "";
const tzResult = await ensureLeadTimezone(leadId, { conversationText: latestMessageBody });
```

### 3. Inject into each prompt builder

Add `dateContext` and `leadTimezoneContext` parameters to opts for:

- **`buildSmsPrompt`** — Insert before Guidelines section:
  ```
  ${opts.dateContext}
  ${opts.leadTimezoneContext}
  ```

- **`buildLinkedInPrompt`** — Same placement

- **`buildEmailPrompt`** — Insert before SCHEDULING RULES section

- **`buildEmailDraftStrategyInstructions`** — Insert after CONTEXT section, before LEAD INFORMATION:
  ```
  DATE CONTEXT:
  ${opts.dateContext}

  LEAD TIMEZONE:
  ${opts.leadTimezoneContext}
  IMPORTANT: When the lead mentions times, interpret them in their timezone. When offering times, reference the lead's timezone if known.
  ```

### 4. Add `extractTimingPreferencesFromText` (deterministic, regex-only)

```typescript
function extractTimingPreferencesFromText(text: string, timeZone: string): {
  weekdayTokens?: string[];
  relativeWeek?: "this_week" | "next_week";
} | null
```

Regex patterns:
- Weekdays: `/\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?)\b/i`
- "next week": `/\bnext\s+week\b/i`
- "this week" / "later this week": `/\b(this|later\s+this)\s+week\b/i`

### 5. Pre-filter slots before distribution

Before `selectDistributedAvailabilitySlots` call in `generateResponseDraft()`:

```typescript
let filteredSlots = slots.slotsUtc;

if (triggerMessageRecord?.body) {
  const prefs = extractTimingPreferencesFromText(triggerMessageRecord.body, timeZone);
  if (prefs?.weekdayTokens?.length) {
    const weekdayFiltered = filteredSlots.filter(iso => {
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
        .format(new Date(iso)).toLowerCase().slice(0, 3);
      return prefs.weekdayTokens!.includes(weekday);
    });
    if (weekdayFiltered.length > 0) filteredSlots = weekdayFiltered;
    // Fail-open: if no matches, keep all
  }
}
```

Pass `filteredSlots` (instead of `slots.slotsUtc`) to `selectDistributedAvailabilitySlots`.

### 6. Cross-phase safety in shared file

`lib/ai-drafts.ts` is concurrently touched by active phases. Keep edits scoped:

- change only scheduling/timezone prompt and slot-selection sections
- avoid pricing/knowledge-context sections modified by other phases

### 7. Verify

- Prompt output for email draft includes "Today is Wednesday, February 12, 2026 (EST)."
- Prompt output includes "Lead's timezone: America/Los_Angeles"
- `extractTimingPreferencesFromText("This Friday could work")` → `{ weekdayTokens: ["fri"] }`
- Lead says "This Friday" → only Friday slots in the filtered pool

## Output

- `lib/ai-drafts.ts` updated with:
  - `buildDateContext()` helper
  - `dateContext` + `leadTimezoneContext` injected into all 4 prompt builders
  - `conversationText` passed to `ensureLeadTimezone`
  - `extractTimingPreferencesFromText()` function
  - Slot pre-filtering before distribution

## Handoff

Phase 139c uses the same scheduling section to apply lead-local business-hours filtering and enforce lead-timezone labels.
