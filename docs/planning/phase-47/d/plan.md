# Phase 47d — UI: Editable Prompt Modal in Settings

## Focus

Transform the read-only prompt modal in Settings → AI Personality → AI Dashboard into an editable interface where admins can modify, save, and reset prompt content.

## Inputs

- Server actions from 47c
- Existing prompt modal in `settings-view.tsx` (lines 3096-3153)
- UI patterns from existing settings components

## Work

1. **Update state management in settings-view.tsx:**

```typescript
// Add to existing state
const [promptOverrides, setPromptOverrides] = useState<Map<string, string>>(new Map());
const [editingPrompt, setEditingPrompt] = useState<{
  promptKey: string;
  role: string;
  index: number;
} | null>(null);
const [editContent, setEditContent] = useState("");
const [savingOverride, setSavingOverride] = useState(false);
```

2. **Fetch overrides when modal opens:**

```typescript
const handleOpenPromptsModal = async () => {
  setAiPromptsOpen(true);
  setAiPromptsLoading(true);

  const [templatesRes, overridesRes] = await Promise.all([
    getAiPromptTemplates(activeWorkspace.id),
    getPromptOverrides(activeWorkspace.id),
  ]);

  if (templatesRes.success) {
    setAiPromptTemplates(templatesRes.templates || []);
  }

  if (overridesRes.success && overridesRes.overrides) {
    const map = new Map<string, string>();
    for (const o of overridesRes.overrides) {
      map.set(`${o.promptKey}:${o.role}:${o.index}`, o.content);
    }
    setPromptOverrides(map);
  }

  setAiPromptsLoading(false);
};
```

3. **Transform message display to support editing:**

Replace the static message display (lines 3134-3141) with:

```tsx
{parts.map((p, i) => {
  const overrideKey = `${t.key}:${role}:${i}`;
  const hasOverride = promptOverrides.has(overrideKey);
  const displayContent = hasOverride
    ? promptOverrides.get(overrideKey)!
    : p.content;
  const isEditing = editingPrompt?.promptKey === t.key
    && editingPrompt?.role === role
    && editingPrompt?.index === i;

  return (
    <div key={`${t.key}:${role}:${i}`} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasOverride && (
            <Badge variant="secondary" className="text-xs">
              Modified
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingPrompt({ promptKey: t.key, role, index: i });
                setEditContent(displayContent);
              }}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {hasOverride && !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleResetOverride(t.key, role, i)}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="min-h-[200px] font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingPrompt(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => handleSaveOverride(t.key, role, i)}
              disabled={savingOverride}
            >
              {savingOverride ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
          {displayContent}
        </div>
      )}
    </div>
  );
})}
```

4. **Add handler functions:**

```typescript
const handleSaveOverride = async (
  promptKey: string,
  role: string,
  index: number
) => {
  setSavingOverride(true);
  const result = await savePromptOverride(activeWorkspace.id, {
    promptKey,
    role: role as "system" | "assistant" | "user",
    index,
    content: editContent,
  });

  if (result.success) {
    setPromptOverrides((prev) => {
      const next = new Map(prev);
      next.set(`${promptKey}:${role}:${index}`, editContent);
      return next;
    });
    setEditingPrompt(null);
    toast({ title: "Prompt saved", description: "Your changes have been saved." });
  } else {
    toast({
      title: "Error",
      description: result.error || "Failed to save prompt",
      variant: "destructive",
    });
  }
  setSavingOverride(false);
};

const handleResetOverride = async (
  promptKey: string,
  role: string,
  index: number
) => {
  const result = await resetPromptOverride(
    activeWorkspace.id,
    promptKey,
    role,
    index
  );

  if (result.success) {
    setPromptOverrides((prev) => {
      const next = new Map(prev);
      next.delete(`${promptKey}:${role}:${index}`);
      return next;
    });
    toast({ title: "Reset to default", description: "Prompt restored to original content." });
  } else {
    toast({
      title: "Error",
      description: result.error || "Failed to reset prompt",
      variant: "destructive",
    });
  }
};
```

5. **Add required imports:**

```typescript
import {
  getAiPromptTemplates,
  getPromptOverrides,
  savePromptOverride,
  resetPromptOverride,
} from "@/actions/ai-observability-actions";
import { Pencil, RotateCcw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
```

6. **Update dialog header to indicate edit mode:**

```tsx
<DialogHeader>
  <DialogTitle>Backend Prompts</DialogTitle>
  <DialogDescription>
    View and customize AI prompt templates. Changes apply to this workspace only.
  </DialogDescription>
</DialogHeader>
```

## Output

- Editable prompt modal in Settings → AI Personality
- Visual indicators for modified prompts
- Save and reset functionality
- Toast notifications for user feedback

## Handoff

Phase complete. Run verification:
- `npm run lint`
- `npm run build`
- `npm run db:push`
- Manual test: edit a prompt, trigger AI, verify override is used
