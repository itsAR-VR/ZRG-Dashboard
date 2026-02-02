# Phase 87a — Slot Parsing Utility

## Focus
Create `lib/availability-slot-parser.ts` with deterministic helpers to detect, extract, and replace availability sections in draft content while preserving all non-slot prose exactly (including line endings).

## Inputs
- Root plan context: availability is embedded as bullet lists with headers like "Available times..." or "AVAILABLE TIMES..."
- Slot label format from `lib/availability-format.ts`: `{time} {TZ} on {day}` (e.g., "2:30 PM EST on Wed, Feb 5")

## Work

### 1. Implement detection function
```typescript
export function hasAvailabilitySection(content: string): boolean
```
Returns true if content contains an availability header pattern.

### 2. Implement extraction function
```typescript
export function extractAvailabilitySection(content: string): null | {
  headerLine: string;     // exact matched header line (preserve casing/punctuation)
  slotLines: string[];    // bullet bodies (no leading "-" / indentation)
  fullMatch: string;      // full matched substring (header + bullets)
  startIndex: number;
  endIndex: number;       // exclusive
  sectionCount: number;   // total availability sections detected in content
}
```
Uses regex to find availability sections and returns the first section’s span + bullets (while also reporting `sectionCount`).

### 3. Implement replacement function
```typescript
export function replaceAvailabilitySlotsInContent(
  content: string,
  newSlotLabels: string[]
): string
```
Replaces only the bullet items for the **first** availability section, while preserving the matched header line, surrounding prose, and the original newline style (`\n` vs `\r\n`).

### 4. Regex patterns
- Header detection must match either:
  - `Available times` (SMS/LinkedIn) OR `AVAILABLE TIMES` (Email), followed by any text until end-of-line.
- Must support LF and CRLF line endings.
- Bullet detection must support indentation: `^\s*-\s+.+$` lines following the header, stopping at the first non-bullet line or EOF.

### 5. Edge cases to handle
- No availability section → return null from extract
- Multiple availability sections → extract reports `sectionCount` but replacement updates the **first** section only
- Malformed content (header with no bullets) → treat as “no section” (return null) so the server action can return a user-friendly error

## Output
- New file: `lib/availability-slot-parser.ts`
- Exported functions: `hasAvailabilitySection`, `extractAvailabilitySection`, `replaceAvailabilitySlotsInContent`

## Handoff
Phase 87b will import these functions to implement the server action that fetches fresh slots and uses `replaceAvailabilitySlotsInContent()` to update draft content.

## Output (Completed)
- Added `lib/availability-slot-parser.ts` with deterministic parsing/replacement that preserves newline style and replaces only the first availability section.

## Handoff (Ready)
Proceed to Phase 87b: wire the new parser into `actions/message-actions.ts` via `refreshDraftAvailability(...)`.
