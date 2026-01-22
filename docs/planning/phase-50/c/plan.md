# Phase 50c — Helpers: Create Email Participant Formatting Utilities

## Focus

Create a new `lib/email-participants.ts` file with utility functions for formatting, validating, and manipulating email participant data.

## Inputs

- Schema from subphase a (Message has fromEmail/fromName/toEmail/toName)
- UI requirements: display `Name <email>` format, chip-style CC list
- UI message boundary: `actions/lead-actions.ts:getConversation(...)` maps Prisma `Message` → UI `Message` (`lib/mock-data.ts`)

## Work

### 1. Create `lib/email-participants.ts`

```typescript
/**
 * Email participant formatting and validation utilities
 */

export interface EmailParticipant {
  email: string;
  name?: string | null;
}

/**
 * Format a participant as "Name <email>" or just "email" if no name
 */
export function formatEmailParticipant(
  email: string,
  name?: string | null
): string {
  if (name && name.trim()) {
    return `${name.trim()} <${email}>`;
  }
  return email;
}

/**
 * Format a participant object
 */
export function formatParticipant(participant: EmailParticipant): string {
  return formatEmailParticipant(participant.email, participant.name);
}

/**
 * Format a CC list for display
 * Shows first 2 emails, then "+N more" for longer lists
 */
export function formatCcList(cc: string[], maxDisplay: number = 2): string {
  if (cc.length === 0) return "";
  if (cc.length <= maxDisplay) return cc.join(", ");
  return `${cc.slice(0, maxDisplay).join(", ")} +${cc.length - maxDisplay} more`;
}

/**
 * Validate email format (basic validation)
 */
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Parse email addresses from various formats
 * Handles: "email@example.com", "Name <email@example.com>", etc.
 */
export function parseEmailAddress(input: string): EmailParticipant | null {
  const trimmed = input.trim();

  // Try "Name <email>" format
  const angleMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1].trim();
    const email = angleMatch[2].trim();
    if (validateEmail(email)) {
      return { email, name: name || null };
    }
  }

  // Try plain email
  if (validateEmail(trimmed)) {
    return { email: trimmed, name: null };
  }

  return null;
}

/**
 * Deduplicate email list (case-insensitive)
 */
export function deduplicateEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  return emails.filter((email) => {
    const lower = email.toLowerCase().trim();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}
```

### 2. Extend UI message shape (`lib/mock-data.ts`)

Update `export interface Message` to include the new optional participant fields:

- `fromEmail?: string`
- `fromName?: string | null`
- `toEmail?: string`
- `toName?: string | null`

Also add any provider-detection fields the UI needs (recommended: `emailBisonReplyId?: string` so the UI can detect `smartlead:` / `instantly:` thread handles).

### 3. Plumb fields into the conversation payload (`actions/lead-actions.ts`)

Update `getConversation(...)` message mapping to include:

- `fromEmail: msg.fromEmail || undefined`
- `fromName: msg.fromName ?? null`
- `toEmail: msg.toEmail || undefined`
- `toName: msg.toName ?? null`
- `emailBisonReplyId: msg.emailBisonReplyId || undefined` (if using provider detection via prefixes)

## Output

- Created `lib/email-participants.ts` with:
  - `formatEmailParticipant()`, `formatParticipant()`, `formatCcList()`
  - `validateEmail()`, `parseEmailAddress()`
  - `deduplicateEmails()`, `normalizeEmail()`, `sanitizeCcList()`
- Updated `lib/mock-data.ts` Message interface with:
  - `fromEmail`, `fromName`, `toEmail`, `toName`
  - `emailBisonReplyId` (for provider detection via `smartlead:` / `instantly:` prefixes)
- Updated `actions/lead-actions.ts` getConversation() message mapping to include all new fields

## Handoff

Subphase d will use these utilities to display email participant headers in chat messages.
