# Phase 45b — Post-Processing Sanitization

## Focus

Add a safety net in `lib/ai-drafts.ts` that sanitizes AI-generated draft content before saving. This catches:
1. Placeholder patterns that slip through despite prompt instructions (Bug 1 fallback)
2. Truncated URLs from hitting output token limits (Bug 2)

## Inputs

- Subphase a completed: Prompt now tells AI not to use placeholders
- Known patterns to catch:
  - `{insert booking link}`, `{booking link}`, `{calendar link}`, `{calendarLink}`
  - `[insert booking link]`, `[booking link]`, `[your booking link]`
  - Truncated URLs like `https://c`, `https://cal`, `http://example`
- Save location: `lib/ai-drafts.ts` around line 1686 before `prisma.aIDraft.create`

## Work

### 1. Read current file state

Read `lib/ai-drafts.ts` to find:
- The exact location of draft creation (`prisma.aIDraft.create`)
- Any existing content sanitization/validation
- Import structure for adding new utility function

### 2. Define sanitization patterns

Create regex patterns for:

**Placeholder patterns** (case-insensitive):
- `/\{insert booking link\}/gi`
- `/\{booking link\}/gi`
- `/\{calendar link\}/gi`
- `/\{calendarLink\}/gi`
- `/\[insert booking link\]/gi`
- `/\[booking link\]/gi`
- `/\[your booking link\]/gi`

**Truncated URL pattern**:
- URLs that end abruptly (e.g., `https://c` followed by whitespace or end of string)
- Pattern: `/https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.?(?=\s|$)/g`
- This matches URLs that don't have a proper domain structure (missing TLD, etc.)

### 3. Add sanitization function

```typescript
// Placeholder patterns the AI might generate when no booking link provided
const BOOKING_LINK_PLACEHOLDERS = [
  /\{insert booking link\}/gi,
  /\{booking link\}/gi,
  /\{calendar link\}/gi,
  /\{calendarLink\}/gi,
  /\[insert booking link\]/gi,
  /\[booking link\]/gi,
  /\[your booking link\]/gi,
];

// Truncated URL pattern - matches URLs without proper domain/TLD
// Examples: "https://c", "http://cal", "https://example"
const TRUNCATED_URL_PATTERN = /https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.?(?=\s|$)/g;

/**
 * Sanitize AI draft content by removing placeholder booking links and truncated URLs.
 * This is a safety net for when prompt instructions fail to prevent bad output.
 */
export function sanitizeDraftContent(
  content: string,
  leadId: string,
  channel: string
): string {
  let result = content;
  let hadPlaceholders = false;
  let hadTruncatedUrl = false;

  // Check and remove placeholder patterns
  for (const pattern of BOOKING_LINK_PLACEHOLDERS) {
    if (pattern.test(result)) {
      hadPlaceholders = true;
      // Reset regex lastIndex before replace (important for /g patterns)
      pattern.lastIndex = 0;
      result = result.replace(pattern, '');
    }
    // Reset for next iteration
    pattern.lastIndex = 0;
  }

  // Check and remove truncated URLs
  const truncatedMatches = result.match(TRUNCATED_URL_PATTERN);
  if (truncatedMatches && truncatedMatches.length > 0) {
    hadTruncatedUrl = true;
    result = result.replace(TRUNCATED_URL_PATTERN, '');
  }

  // Log if we had to sanitize
  if (hadPlaceholders || hadTruncatedUrl) {
    console.warn(
      `[AI Drafts] Sanitized draft for lead ${leadId} (${channel}):`,
      { hadPlaceholders, hadTruncatedUrl }
    );
    // Clean up double spaces and trim
    result = result.replace(/\s{2,}/g, ' ').trim();
  }

  return result;
}
```

### 4. Integrate into draft save flow

Find the location where `draftContent` is finalized and call sanitization before save:

```typescript
// Before saving
draftContent = sanitizeDraftContent(draftContent, leadId, channel);

// Existing save logic
const draft = await prisma.aIDraft.create({
  data: {
    leadId,
    channel,
    content: draftContent,
    // ... rest of fields
  }
});
```

### 5. Test the regex patterns

Verify patterns work correctly:
- `{insert booking link}` → removed
- `{BOOKING LINK}` → removed (case insensitive)
- `https://c ` → removed (truncated)
- `https://calendly.com/user` → NOT removed (valid URL)
- `https://cal.com/user` → NOT removed (valid URL)

## Output

- New `sanitizeDraftContent()` function exported from `lib/ai-drafts.ts`
- Function called before every draft save
- Warning logs when sanitization occurs

## Handoff

Subphase c will implement the bulk draft regeneration server action in `actions/message-actions.ts`. The sanitization function created here will automatically apply to all regenerated drafts.
