# Phase 95a — Fast Regen Core (Email Archetype Cycling + SMS/LinkedIn Rewrite)

## Focus
Implement a shared **fast regeneration** helper that rewrites an existing draft with minimal context, optimized for latency and token usage.

This subphase defines the **core algorithm + prompt** and exposes a reusable API for both Slack and dashboard server actions.

## Inputs
- Email archetypes: `lib/ai-drafts/config.ts` (`EMAIL_DRAFT_STRUCTURE_ARCHETYPES`)
- Prompt snippet helpers:
  - `lib/ai/prompt-snippets.ts:getEffectiveArchetypeInstructions`
  - `lib/ai/prompt-snippets.ts:getEffectiveForbiddenTerms`
  - `lib/ai/prompt-snippets.ts:getEffectiveEmailLengthBounds` (for email length clamping)
- Prompt runner: `lib/ai/prompt-runner` (`runTextPrompt`)
- Post-pass safety utilities:
  - `lib/ai-drafts/step3-verifier.ts:enforceCanonicalBookingLink`, `replaceEmDashesWithCommaSpace`
  - `lib/ai-drafts.ts:sanitizeDraftContent` (already exported at line 167)
- Telemetry context: `lib/ai/telemetry-context.ts:withAiTelemetrySourceIfUnset`
- Existing draft generation patterns in `lib/ai-drafts.ts` (persona selection, booking link resolution)

## Work

### 1) Create a new core module
Add `lib/ai-drafts/fast-regenerate.ts` exporting:

```ts
export type FastRegenChannel = "sms" | "email" | "linkedin";

export async function fastRegenerateDraftContent(opts: {
  clientId: string;
  leadId: string;
  channel: FastRegenChannel;
  sentimentTag: string;
  previousDraft: string;
  // Email-only:
  archetypeId?: string;
  // Minimal context (optional):
  latestInbound?: { subject?: string | null; body: string } | null;
  // Performance controls:
  timeoutMs?: number; // default 20_000
}): Promise<{ success: boolean; content?: string; error?: string }>;
```

Notes:
- This function is **content-only** (no DB writes). DB creation/rejection happens in server actions or Slack handlers.
- It must call `withAiTelemetrySourceIfUnset(...)` with a new source key like:
  - `lib:draft.fast_regen` (generic)
  - or per-channel: `lib:draft.fast_regen.email` / `sms` / `linkedin`

### 2) Archetype cycling utilities (email)
Add a deterministic helper in the same module:

```ts
export function pickCycledEmailArchetype(opts: {
  cycleSeed: string; // stable per thread/session
  regenCount: number; // 0-based
}): EmailDraftArchetype;
```

Rules:
- `baseIndex = absHash(cycleSeed) % 10`
- `targetIndex = (baseIndex + regenCount + 1) % 10`
  - `+1` ensures the first regen always changes archetype vs the base.
- Apply workspace overrides for the selected archetype instructions via `getEffectiveArchetypeInstructions(archetype.id, clientId)`.

### 3) Prompt design (min context)
Fast regen prompt must be **rewrite-focused**:

Email prompt requirements:
- Input includes:
  - `previousDraft` (full)
  - `latestInbound` (optional, trimmed)
  - `sentimentTag`
  - `TARGET STRUCTURE ARCHETYPE` name + instructions
- Output rules (hard):
  - No subject line
  - Plain text (no bold/italics/headers/code)
  - Do not invent facts
  - Preserve any offered availability times *verbatim* if they exist in the previous draft (do not create new times)
  - Preserve or update signature to match the provided signature text
  - If opt-out/unsubscribe/bounce is detected in `latestInbound` or `previousDraft`, output empty string
  - Never imply a meeting is booked

SMS/LinkedIn prompt requirements:
- Rewrite previous draft only (optionally consider `latestInbound`), keep concise:
  - SMS: 1–3 short sentences, clamp to 320 chars
  - LinkedIn: clamp to 800 chars

Model/runtime defaults (RED TEAM confirmed):
- **Model**: `gpt-5-mini` for all channels
- **Reasoning effort**: `"low"`
- **maxOutputTokens**: email ~600–1000, SMS ~200, LinkedIn ~400
- **Timeout**: `timeoutMs: 20_000` (default), target < 8s
- Retry on `timeout`/`rate_limit` once, then fail

### 4) Deterministic post-processing
After model output:
- Apply deterministic cleanup:
  - `replaceEmDashesWithCommaSpace`
  - enforce canonical booking link via `enforceCanonicalBookingLink` (requires resolving canonical booking link)
  - sanitize content (reuse existing sanitizer; if not exported, extract and export the sanitizer from `lib/ai-drafts.ts` as a stable utility)
  - Email: clamp to effective email bounds (use `getEffectiveEmailLengthBounds` or existing bounds helper)
  - SMS/LinkedIn: clamp to channel max chars

### 5) Telemetry
- Use a distinct `featureId` for prompt runner, e.g.:
  - `draft.fast_regen.email`
  - `draft.fast_regen.sms`
  - `draft.fast_regen.linkedin`
- Prompt keys should include archetype id for email, e.g. `draft.fast_regen.email.v1.arch_A1_short_paragraph_bullets_question`.
- Source attribution: `withAiTelemetrySourceIfUnset("lib:draft.fast_regen")` wrapping the prompt call.

### 6) Channel character limits (RED TEAM)
Add constants to the module:

```ts
export const FAST_REGEN_CHANNEL_LIMITS = {
  sms: 320,
  linkedin: 800,
} as const;
```

For email, use `getEffectiveEmailLengthBounds(clientId)` dynamically.

### 7) Canonical booking link resolution (RED TEAM)
For email drafts, the canonical booking link must be resolved for `enforceCanonicalBookingLink`:

```ts
// Option A: Pass as parameter
canonicalBookingLink?: string;

// Option B: Resolve internally
const lead = await prisma.lead.findUnique({
  where: { id: leadId },
  select: { workspaceCalendarLink: true, client: { select: { defaultCalendarLink: true } } }
});
const canonicalBookingLink = lead?.workspaceCalendarLink || lead?.client.defaultCalendarLink || null;
```

Prefer Option A (pass as parameter) for flexibility — caller can resolve via existing `getCalendarLinkForLead` action.

## Validation (RED TEAM)

Before marking this subphase complete, verify:
- [ ] `fastRegenerateDraftContent` compiles without type errors
- [ ] `pickCycledEmailArchetype` returns different archetype for `regenCount=0` vs `regenCount=1` with same seed
- [ ] Empty `previousDraft` returns error without calling AI
- [ ] Output is clamped to channel limits (320 for SMS, 800 for LinkedIn, dynamic for email)
- [ ] `enforceCanonicalBookingLink` is applied to email output
- [ ] Telemetry source is set via `withAiTelemetrySourceIfUnset`

## Output
- Implemented `lib/ai-drafts/fast-regenerate.ts`:
  - `fastRegenerateDraftContent(...)` (email + sms + linkedin; DB reads only, no writes)
  - `pickCycledEmailArchetypeId({ cycleSeed, regenCount })` (deterministic cycling across the 10 archetypes)
- Email fast regen behavior:
  - Uses workspace overrides for archetype instructions (`getEffectiveArchetypeInstructions`)
  - Uses workspace forbidden terms + email length rules (`getEffectiveForbiddenTerms`, `buildEffectiveEmailLengthRules`)
  - Enforces canonical booking link deterministically (`resolveBookingLink` + `enforceCanonicalBookingLink`)
  - Honors lead-provided scheduler link by disabling our booking link enforcement and stripping our canonical link if it sneaks in
- Telemetry:
  - Wrapped in `withAiTelemetrySourceIfUnset("lib:draft.fast_regen.<channel>")`

## Handoff
Proceed to Phase 95b to wire Slack `Regenerate` → `fastRegenerateDraftContent` and update Slack message blocks + interactions handler.
