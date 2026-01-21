# Phase 47b — Prompt Registry: Workspace Override Lookup

## Focus

Modify the prompt registry to check for workspace-specific overrides before returning default prompts, enabling per-workspace prompt customization.

## Inputs

- `PromptOverride` model from 47a
- Existing `listAIPromptTemplates()` function
- Understanding of prompt message structure

## Work

1. **Add new function to `lib/ai/prompt-registry.ts`:**

```typescript
import { prisma } from "@/lib/prisma";
import type { PromptOverride } from "@prisma/client";

/**
 * Get a prompt template with workspace-specific overrides applied.
 * Falls back to code defaults for any messages without overrides.
 */
export async function getPromptWithOverrides(
  promptKey: string,
  clientId: string
): Promise<AIPromptTemplate | null> {
  // Get base template from code
  const base = listAIPromptTemplates().find((t) => t.key === promptKey);
  if (!base) return null;

  // Fetch overrides for this workspace + prompt
  const overrides = await prisma.promptOverride.findMany({
    where: { clientId, promptKey },
  });

  if (overrides.length === 0) {
    return base; // No overrides, return default
  }

  // Build override lookup map: `${role}:${index}` -> { content, baseContentHash }
  const overrideMap = new Map<string, { content: string; baseContentHash: string }>();
  for (const o of overrides) {
    overrideMap.set(`${o.role}:${o.index}`, {
      content: o.content,
      baseContentHash: o.baseContentHash,
    });
  }

  // Apply overrides to messages (only if base content still matches)
  const messages = base.messages.map((msg, idx) => {
    // Calculate index within this role
    const roleIndex = base.messages
      .slice(0, idx)
      .filter((m) => m.role === msg.role).length;

    const key = `${msg.role}:${roleIndex}`;
    const override = overrideMap.get(key);

    if (!override) return msg;

    // Prevent index drift: only apply if the base message content hash matches
    const currentBaseHash = hashString(msg.content); // sha256 helper (server-only)
    if (currentBaseHash !== override.baseContentHash) return msg;

    return { ...msg, content: override.content };
  });

  return { ...base, messages };
}
```

2. **Add helper to check if prompt has overrides:**

```typescript
export async function hasPromptOverrides(
  promptKey: string,
  clientId: string
): Promise<boolean> {
  const count = await prisma.promptOverride.count({
    where: { clientId, promptKey },
  });
  return count > 0;
}
```

3. **Update AI call sites to use overrides:**

Key files that call prompts:
- `lib/sentiment.ts` — sentiment classification
- `lib/ai-drafts.ts` — draft generation
- `lib/auto-reply-gate.ts` — reply decision
- `lib/insights-chat.ts` — insights chat

For each, update to use `getPromptWithOverrides()` when `clientId` is available:

```typescript
// Before
const template = getPromptTemplate("sentiment.classify.v1");

// After
const template = await getPromptWithOverrides("sentiment.classify.v1", clientId)
  ?? getPromptTemplate("sentiment.classify.v1");
```

**Note:** Phase 47b should focus on the registry layer. Updating all call sites can be done incrementally or as a follow-up if it creates too much scope.

## Output

**Completed:**
- Added `hashPromptContent(content)` — stable SHA-256 hash (truncated to 16 chars) for drift detection
- Added `computePromptMessageBaseHash({ promptKey, role, index })` — computes base hash for a specific message
- Added `hasPromptOverrides(promptKey, clientId)` — checks if overrides exist
- Added `getPromptOverrideMap(clientId)` — returns all overrides for UI display
- Added `getPromptWithOverrides(promptKey, clientId)` — returns template with overrides applied + version suffix

**Key implementation details:**
- Override addressing uses `${role}:${index}` where index is 0-based within that role's messages
- Drift detection: compares `baseContentHash` stored in override with current template hash; mismatches are ignored
- Telemetry versioning: returns `overrideVersion` suffix (e.g., `ovr_20260121T0800`) for `AIInteraction.promptKey`
- Returns `{ template, overrideVersion, hasOverrides }` to support both runtime and observability needs

**Note:** AI call site updates deferred to Phase 47i (call-site alignment) per plan scope.

## Handoff

Subphase 47c will add server actions for CRUD operations:
- `savePromptOverride()` — create/update override (uses `computePromptMessageBaseHash`)
- `resetPromptOverride()` — delete single override
- `resetAllPromptOverrides()` — delete all overrides for a prompt
- `getPromptOverrides()` — fetch all overrides for UI
