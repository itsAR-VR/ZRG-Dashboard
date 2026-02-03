# Phase 95c — Dashboard Integration (Fast Regen Server Action + UI Buttons)

## Focus
Expose fast regeneration in the dashboard compose experience for **Email + SMS + LinkedIn** by:
- Adding a new server action `fastRegenerateDraft(...)`
- Updating the Action Station UI to show **two labeled buttons**: `Fast Regen` and `Full Regen`

## Inputs
- Fast regen core from Phase 95a (✅ complete): `lib/ai-drafts/fast-regenerate.ts`
  - `fastRegenerateDraftContent(...)` — content-only rewrite (no DB writes)
  - `pickCycledEmailArchetypeId({ cycleSeed, regenCount })` — deterministic archetype cycling
- Slack integration from Phase 95b (✅ complete): patterns for draft rejection + creation, Slack message update
- Existing full regen server action: `actions/message-actions.ts:regenerateDraft`
- Existing compose UI + handlers: `components/dashboard/action-station.tsx`

## Work

### 1) Add server action: `fastRegenerateDraft`
File: `actions/message-actions.ts`

API:
```ts
export async function fastRegenerateDraft(
  leadId: string,
  channel: "sms" | "email" | "linkedin" = "sms",
  opts?: {
    // Email-only archetype cycling (UI-managed)
    cycleSeed?: string;
    regenCount?: number;
  }
): Promise<{ success: boolean; data?: { id: string; content: string }; error?: string }>;
```

Behavior:
1. `requireLeadAccess(leadId)`.
2. Fetch `Lead` minimal fields needed:
   - `sentimentTag`, `email` (for email eligibility), `clientId`.
3. Identify the previous draft to rewrite:
   - Prefer the latest `pending` draft for `leadId + channel`.
   - Else fallback to most recent draft (any status) for `leadId + channel`.
   - If none exists, fall back to `regenerateDraft(leadId, channel)` (full) and return its result.
4. Reject any existing pending drafts for this lead+channel (server-side).
5. For email:
   - Determine cycleSeed:
     - Use `opts.cycleSeed` when provided, else default to `previousDraft.id`.
   - Determine regenCount:
     - Use `opts.regenCount` when provided, else `0`.
   - Pick archetype via `pickCycledEmailArchetype({ cycleSeed, regenCount })`.
6. Call `fastRegenerateDraftContent(...)`:
   - Provide `clientId`, `leadId`, `channel`, `sentimentTag`, `previousDraft.content`.
   - Provide `latestInbound` snippet by loading the latest inbound `Message` for that lead + channel (subject + body for email, body only otherwise).
7. Create a new `AIDraft`:
   - `leadId`, `channel`, `status=pending`, `triggerMessageId=null`, `content=newContent`.
8. `revalidatePath("/")` and return `{ id, content }`.

Notes:
- The server action should be the only place that rejects drafts for fast regen (remove client-side reject-before-regen).

### 2) Update Action Station UI
File: `components/dashboard/action-station.tsx`

UI changes (decision complete):
- When an AI draft exists (`hasAiDraft`):
  - Replace the current single regenerate icon button with **two labeled buttons**:
    - `Fast Regen` (calls new server action)
    - `Full Regen` (calls existing `regenerateDraft`)
- When no AI draft exists:
  - Keep the existing `Compose with AI` button, wired to `Full Regen`.

State changes:
- Split regeneration state into two booleans:
  - `isRegeneratingFast`, `isRegeneratingFull`
  - `isRegeneratingAny = isRegeneratingFast || isRegeneratingFull`
- Add email archetype cycling state (client-only):
  - `fastRegenCycleSeed: string | null`
  - `fastRegenCount: number`

Cycling rules:
- **Initialization timing (RED TEAM clarification)**: Initialize cycling state in a `useEffect` when `drafts` array changes (not on component mount). This ensures state is reset when switching leads.
- On first time a draft is loaded into compose for this conversation, set:
  - `fastRegenCycleSeed = drafts[0]?.id ?? null`
  - `fastRegenCount = 0`
- On `Fast Regen` success:
  - Keep `fastRegenCycleSeed` unchanged
  - Increment `fastRegenCount` by 1
- On `Full Regen` success:
  - Reset `fastRegenCycleSeed = newDraftId`
  - Reset `fastRegenCount = 0`
- **Note**: Cycling state is ephemeral — resets on page refresh. This is acceptable per design.

Handler updates:
- Remove client-side `rejectDraft(drafts[0].id)` before calling either regen action.
- On success, update:
  - `drafts` state
  - `composeMessage`
  - `originalDraft`
  - `hasAiDraft`

Layout:
- Use `Button variant="outline" size="sm"` for `Fast Regen` and `Full Regen`.
- Keep existing icons optional; tooltip titles should clearly distinguish the two.

### 3) State splitting complexity (RED TEAM)

The current component has a single `isRegenerating` boolean used in **8+ places** for disabled states. When splitting to `isRegeneratingFast` + `isRegeneratingFull`:

Update all usages of `isRegenerating` to `isRegeneratingAny`:
- Line 973, 976, 1076, 1084, 1123, 1135, 1152, 1163, 1164, 1168, 1178, 1200, 1209

Search pattern: `isRegenerating` → replace with `isRegeneratingAny` for disabled checks.

## Validation (RED TEAM)

Before marking this subphase complete, verify:
- [ ] `fastRegenerateDraft` server action compiles and exports correctly
- [ ] `requireLeadAccess` is called before any database operations
- [ ] Draft ownership is validated (draft belongs to workspace)
- [ ] `Fast Regen` button appears when AI draft exists
- [ ] `Full Regen` button appears when AI draft exists
- [ ] Both buttons are disabled while either regen is in progress (`isRegeneratingAny`)
- [ ] `Fast Regen` produces new draft < 10s
- [ ] Email `Fast Regen` cycles through archetypes on repeated clicks
- [ ] `fastRegenCount` increments correctly
- [ ] `fastRegenCycleSeed` resets on `Full Regen`
- [ ] No regression to existing `Compose with AI` flow

## Output
- Added server action `fastRegenerateDraft(...)`:
  - File: `actions/message-actions.ts`
  - Rejects existing pending drafts server-side, rewrites the latest draft via `fastRegenerateDraftContent`, creates a new pending `AIDraft` (`triggerMessageId` remains `null`), returns `{ id, content }`.
- Updated dashboard compose UI:
  - File: `components/dashboard/action-station.tsx`
  - When a draft exists: shows labeled `Fast Regen` and `Full Regen` buttons.
  - Removed client-side “reject draft before regen”; regeneration is handled server-side.
  - Email fast regen cycles via `fastRegenCycleSeed` + `fastRegenCount` state; full regen resets cycle seed/count.

## Handoff
Proceed to Phase 95d to add/update unit tests and run `npm run lint` + `npm run build`.
