# Phase 96b — AI Refresh Engine (gpt-5-nano structured replacements + validation)

## Focus
Implement the AI-driven engine that:
- inspects the draft content,
- identifies time offers that are unavailable or today/past,
- proposes safe replacements using only the provided candidate labels,
- returns replacements as structured data so we can apply them deterministically with strict validation.

## Inputs
- Phase 96a: `candidates` (≤50) + `labelToDatetimeUtcIso`
- AI prompt runner:
  - `runStructuredJsonPrompt` from `lib/ai/prompt-runner/runner.ts`
  - Model: `gpt-5-nano`
- Lead TZ string (for "today" basis) + `now`

## Work

### Step 1: Create library module
Create `lib/availability-refresh-ai.ts` (server-only) exporting:

```ts
export type AvailabilityRefreshResult = {
  success: true;
  updatedDraft: string;
  replacementsApplied: Array<{ oldText: string; newText: string }>;
  passesUsed: number;
  hasTimeOffers: boolean;
} | {
  success: false;
  error: string;
  hasTimeOffers: boolean;
};

export async function refreshAvailabilityInDraftViaAi(opts: {
  draft: string;
  candidates: Array<{ datetimeUtcIso: string; label: string }>;
  labelToDatetimeUtcIso: Record<string, string>;
  leadTimeZone: string;
  nowUtcIso: string;
  maxPasses?: number; // default 10
  chunkSize?: number; // default 5
  timeoutMs?: number; // default from env: OPENAI_AVAILABILITY_REFRESH_TIMEOUT_MS (fallback 15000)
}): Promise<AvailabilityRefreshResult>;
```

### Step 2: Prompt design

**System prompt:**
```
You are a strict text editor. Your task is to identify and replace outdated or unavailable time offers in an email draft.

Rules:
1. Find time offers in the draft that are NOT in the AVAILABLE_SLOTS list OR that represent times on or before TODAY (based on LEAD_TIMEZONE).
2. For each time offer that needs replacement, select a replacement VERBATIM from AVAILABLE_SLOTS.
3. Do NOT change any text except the time offer strings themselves.
4. Return only up to CHUNK_SIZE replacements per response.
5. If you find no time offers in the draft at all, set hasTimeOffers to false.
6. If all time offers are already valid (present in AVAILABLE_SLOTS and in the future), return empty replacements with done=true.

Match the timezone abbreviation style already used in the draft (e.g., if the draft uses "EST", use "EST" from the candidate labels).

Output ONLY valid JSON. No explanation.
```

**User prompt template:**
```
DRAFT:
{draft}

AVAILABLE_SLOTS:
{candidateLabels}

LEAD_TIMEZONE: {leadTimeZone}
NOW_UTC_ISO: {nowUtcIso}
CHUNK_SIZE: {chunkSize}
```

### Step 3: JSON schema (strict)

```json
{
  "type": "object",
  "properties": {
    "replacements": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "startIndex": { "type": "integer", "minimum": 0 },
          "endIndex": { "type": "integer", "minimum": 0 },
          "oldText": { "type": "string" },
          "newText": { "type": "string" }
        },
        "required": ["startIndex", "endIndex", "oldText", "newText"],
        "additionalProperties": false
      }
    },
    "hasTimeOffers": { "type": "boolean" },
    "done": { "type": "boolean" }
  },
  "required": ["replacements", "hasTimeOffers", "done"],
  "additionalProperties": false
}
```

### Step 4: Strict diff guard / validation

For each replacement in the AI response:

1. **Bounds check:** `startIndex >= 0 && endIndex <= draft.length && startIndex < endIndex`
2. **Content match:** `draft.slice(startIndex, endIndex) === oldText`
3. **Candidate match:** `newText` must exactly match one of `candidates[].label`
4. **No overlap:** Replacements must not have overlapping `[startIndex, endIndex)` ranges

If ANY validation fails:
- Log the failure details (without PII)
- Abort with `{ success: false, error: "Validation failed: <reason>", hasTimeOffers }`
- Do NOT apply partial replacements

### Step 5: Apply replacements deterministically

```ts
function applyReplacements(draft: string, replacements: ValidatedReplacement[]): string {
  // Sort by startIndex descending (reverse order)
  const sorted = [...replacements].sort((a, b) => b.startIndex - a.startIndex);
  let result = draft;
  for (const r of sorted) {
    result = result.slice(0, r.startIndex) + r.newText + result.slice(r.endIndex);
  }
  return result;
}
```

### Step 6: Chunking passes

Loop up to `maxPasses` (default 10):
1. Call AI on current draft state
2. If `hasTimeOffers === false` and `replacements.length === 0`:
   - Return `{ success: false, error: "no_time_offers", hasTimeOffers: false }`
3. Validate replacements
4. If validation passes, apply replacements to get `nextDraft`
5. Accumulate `replacementsApplied`
6. If `done === true` or `replacements.length === 0`:
   - Break and return success
7. Otherwise, continue with `nextDraft`

If passes exhausted without `done`:
- Return `{ success: false, error: "Max passes exceeded", hasTimeOffers: true }`

### Step 7: Telemetry

- `featureId`: `"availability_refresh"`
- `promptKey`: `"availability.refresh.inline"`
- Model: `"gpt-5-nano"`
- `reasoningEffort`: `"minimal"`
- `temperature`: `0.1` (configurable via env `OPENAI_AVAILABILITY_REFRESH_TEMPERATURE`)
- `maxOutputTokens`: `800`
- Timeout: `OPENAI_AVAILABILITY_REFRESH_TIMEOUT_MS` (default 15000)

## Validation (RED TEAM)

- [ ] Verify bounds check catches out-of-range indices.
- [ ] Verify content match catches AI hallucinating `oldText`.
- [ ] Verify candidate match is exact string equality (no fuzzy matching).
- [ ] Verify overlap detection rejects `{startIndex: 0, endIndex: 10}` + `{startIndex: 5, endIndex: 15}`.
- [ ] Verify reverse-order apply produces correct output for multiple adjacent replacements.
- [ ] Verify max passes limit terminates runaway loops.
- [ ] Verify `hasTimeOffers: false` case returns distinct error from validation failure.

## Output
- Added `lib/availability-refresh-ai.ts` with:
  - `refreshAvailabilityInDraftViaAi(...)` (gpt-5-nano, low temp, structured JSON schema, strict validation, max passes).
  - `applyValidatedReplacements(...)` exported for deterministic unit tests.
  - Validation: bounds, content match, candidate-only, no overlaps, no duplicate `newText`.
  - Env controls: `OPENAI_AVAILABILITY_REFRESH_MAX_PASSES`, `OPENAI_AVAILABILITY_REFRESH_CHUNK_SIZE`, `OPENAI_AVAILABILITY_REFRESH_TIMEOUT_MS`, `OPENAI_AVAILABILITY_REFRESH_TEMPERATURE`, `OPENAI_AVAILABILITY_REFRESH_MAX_OUTPUT_TOKENS`.
  - Telemetry: `featureId = availability_refresh`, `promptKey = availability.refresh.inline.v1`.
- Candidate labels are de-duped from `candidates` + `labelToDatetimeUtcIso` before prompting.
- Tests for validation/apply are deferred to Phase 96d.

## Handoff
Phase 96c should wire `refreshAvailabilityInDraftViaAi(...)` into both UI/system refresh actions and use the returned `replacementsApplied` to update `Lead.offeredSlots` + slot ledger.
