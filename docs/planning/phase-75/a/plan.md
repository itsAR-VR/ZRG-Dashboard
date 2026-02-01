# Phase 75a — Update Availability Mode to Always Use Explicit Timezone

## Focus

Change the availability formatting mode selection in AI drafts and follow-up engine from conditional `"your_time"` / `"explicit_tz"` to always use `"explicit_tz"`.

## Inputs

- Root plan context: The `mode` variable is currently set based on timezone inference source
- Current files:
  - `lib/ai-drafts.ts:1221`
  - `lib/followup-engine.ts:494`
  - `lib/followup-engine.ts:2512`

## Work

### Step 1: Update `lib/ai-drafts.ts`

Locate line ~1221:
```typescript
const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";
```

Change to:
```typescript
const mode: AvailabilityLabelMode = "explicit_tz";
```

Note: The import for `AvailabilityLabelMode` already exists at the top of the file (from `lib/availability-format.ts`).

### Step 2: Update `lib/followup-engine.ts` (line ~494)

Locate line ~494:
```typescript
const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";
```

Change to:
```typescript
const mode: AvailabilityLabelMode = "explicit_tz";
```

Ensure `AvailabilityLabelMode` is imported from `@/lib/availability-format`.

### Step 3: Update `lib/followup-engine.ts` (line ~2512)

Locate line ~2512:
```typescript
const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";
```

Change to:
```typescript
const mode: AvailabilityLabelMode = "explicit_tz";
```

## Output

**Completed 2026-01-31**

- `lib/ai-drafts.ts:1221` — Changed from conditional mode to always `"explicit_tz"`
- `lib/followup-engine.ts:494` — Same change
- `lib/followup-engine.ts:2512` — Same change

All three locations now use:
```typescript
const mode = "explicit_tz"; // Always show explicit timezone (e.g., "EST", "PST")
```

Availability slots will now display as `"2:00 PM EST on Wed, Feb 5"` instead of `"2:00 PM (your time) on Wed, Feb 5"`.

## Handoff

Phase 75b verifies the changes via `npm run lint` and `npm run build`.
