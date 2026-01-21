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

  // Build override lookup map: `${role}:${index}` -> content
  const overrideMap = new Map<string, string>();
  for (const o of overrides) {
    overrideMap.set(`${o.role}:${o.index}`, o.content);
  }

  // Apply overrides to messages
  const messages = base.messages.map((msg, idx) => {
    // Calculate index within this role
    const roleIndex = base.messages
      .slice(0, idx)
      .filter((m) => m.role === msg.role).length;

    const key = `${msg.role}:${roleIndex}`;
    const override = overrideMap.get(key);

    return override !== undefined
      ? { ...msg, content: override }
      : msg;
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

- `getPromptWithOverrides()` function exported from prompt-registry
- `hasPromptOverrides()` helper function
- At least one AI call site updated to demonstrate the pattern

## Handoff

Subphase c will use these functions to implement server actions for saving/resetting overrides from the UI.
