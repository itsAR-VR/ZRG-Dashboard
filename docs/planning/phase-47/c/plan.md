# Phase 47c — Server Actions: CRUD for Prompt Overrides

## Focus

Add server actions to create, update, and reset prompt overrides from the UI, with proper admin authorization.

## Inputs

- `PromptOverride` model from 47a
- Override lookup functions from 47b
- Existing `requireClientAdminAccess()` pattern

## Work

0. **Add a safe base-hash helper (server-only):**
   - Implement `computePromptMessageBaseHash({ promptKey, role, index })` by:
     - loading the base template from `lib/ai/prompt-registry.ts`
     - selecting the message by `(role, indexWithinRole)`
     - returning a stable hash (sha256) of the base message content
   - If the message doesn’t exist → reject save with a clear error (prevents writing orphan overrides).

1. **Add server actions to `actions/ai-observability-actions.ts`:**

```typescript
export type PromptOverrideInput = {
  promptKey: string;
  role: "system" | "assistant" | "user";
  index: number;
  content: string;
};

/**
 * Save a prompt override for a workspace.
 * Creates or updates the override.
 */
export async function savePromptOverride(
  clientId: string,
  override: PromptOverrideInput
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    // Compute baseContentHash from the current registry template (prevents index drift)
    const baseContentHash = computePromptMessageBaseHash({
      promptKey: override.promptKey,
      role: override.role,
      index: override.index,
    });

    await prisma.promptOverride.upsert({
      where: {
        clientId_promptKey_role_index: {
          clientId,
          promptKey: override.promptKey,
          role: override.role,
          index: override.index,
        },
      },
      create: {
        clientId,
        promptKey: override.promptKey,
        role: override.role,
        index: override.index,
        baseContentHash,
        content: override.content,
      },
      update: {
        baseContentHash,
        content: override.content,
      },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save override",
    };
  }
}

/**
 * Reset a specific prompt message to default (delete override).
 */
export async function resetPromptOverride(
  clientId: string,
  promptKey: string,
  role: string,
  index: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    await prisma.promptOverride.deleteMany({
      where: { clientId, promptKey, role, index },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset override",
    };
  }
}

/**
 * Reset all overrides for a prompt (restore entire prompt to defaults).
 */
export async function resetAllPromptOverrides(
  clientId: string,
  promptKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireWorkspaceAdmin(clientId);

    await prisma.promptOverride.deleteMany({
      where: { clientId, promptKey },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset overrides",
    };
  }
}

/**
 * Get all overrides for a workspace (for displaying in UI).
 */
export async function getPromptOverrides(
  clientId: string
): Promise<{
  success: boolean;
  overrides?: Array<{
    promptKey: string;
    role: string;
    index: number;
    content: string;
  }>;
  error?: string;
}> {
  try {
    await requireWorkspaceAdmin(clientId);

    const overrides = await prisma.promptOverride.findMany({
      where: { clientId },
      select: {
        promptKey: true,
        role: true,
        index: true,
        baseContentHash: true,
        content: true,
      },
    });

    return { success: true, overrides };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load overrides",
    };
  }
}
```

2. **Export types from actions file:**

Ensure `PromptOverrideInput` is exported for use in UI components.

## Output

**Completed:**
- Added types: `PromptOverrideInput`, `PromptOverrideRecord`
- Added `savePromptOverride(clientId, override)` — create/update with automatic baseContentHash computation
- Added `resetPromptOverride(clientId, promptKey, role, index)` — delete single override
- Added `resetAllPromptOverrides(clientId, promptKey)` — delete all overrides for a prompt (returns deletedCount)
- Added `getPromptOverrides(clientId)` — fetch all overrides for UI display

**Key implementation details:**
- All actions are admin-gated via `requireWorkspaceAdmin(clientId)`
- `savePromptOverride` validates that the target message exists (returns clear error if not)
- `baseContentHash` is recomputed on every save (always reflects current template)
- Actions use the existing pattern: `{ success: boolean; error?: string; ... }`

**File modified:** `actions/ai-observability-actions.ts`

## Handoff

Subphase 47d will transform the read-only "Backend Prompts" modal in `settings-view.tsx` into an editable interface using these server actions.
