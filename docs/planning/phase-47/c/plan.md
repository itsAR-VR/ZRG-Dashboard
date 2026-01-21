# Phase 47c — Server Actions: CRUD for Prompt Overrides

## Focus

Add server actions to create, update, and reset prompt overrides from the UI, with proper admin authorization.

## Inputs

- `PromptOverride` model from 47a
- Override lookup functions from 47b
- Existing `requireClientAdminAccess()` pattern

## Work

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
        content: override.content,
      },
      update: {
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

- `savePromptOverride()` — create/update an override
- `resetPromptOverride()` — delete a single override
- `resetAllPromptOverrides()` — delete all overrides for a prompt
- `getPromptOverrides()` — fetch all overrides for a workspace

## Handoff

Subphase d will use these server actions to build the editable UI in the prompt modal.
