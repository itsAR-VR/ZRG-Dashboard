# Phase 45d — Settings UI for Bulk Draft Regeneration

## Focus

Add a UI component in the Settings page (AI Personality tab) that allows workspace admins to bulk regenerate AI drafts. The UI provides channel selection, progress tracking, and continuation support.

## Inputs

- Subphase c completed: `regenerateAllDrafts()` server action available
- Location: `components/dashboard/settings-view.tsx` in `TabsContent value="ai"` (AI Personality tab)
- Access control: Admin-only feature using existing `isWorkspaceAdmin` gate from `getWorkspaceAdminStatus`
- Return type: `RegenerateAllDraftsResult` from subphase c

## Work

### 1. Read current Settings view structure

Read `components/dashboard/settings-view.tsx` to understand:
- Tab structure (find AI Personality tab)
- Existing patterns for admin-only sections
- State management approach
- Toast notification patterns

### 2. Design UI component

```
┌─────────────────────────────────────────────────────────┐
│ Bulk Regenerate AI Drafts                               │
│─────────────────────────────────────────────────────────│
│                                                         │
│ Channel:  [▼ Email        ]                            │
│                                                         │
│ [ Regenerate All Drafts ]  [ Reset ]                   │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐│
│ │ Progress: 45/120 eligible leads processed           ││
│ │ ━━━━━━━━━━━━━━━━━▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░ ││
│ │                                                     ││
│ │ Regenerated: 42 │ Skipped: 2 │ Errors: 1            ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ [ Continue ]  (More leads to process)                  │
│                                                         │
│ ⚠ This regenerates drafts in bulk (default: pending     │
│   drafts only).                                         │
└─────────────────────────────────────────────────────────┘
```

### 3. Component state

```typescript
interface RegenerateAllState {
  channel: "sms" | "email" | "linkedin";
  isRunning: boolean;
  progress: {
    totalEligible: number;
    processedLeads: number;
    regenerated: number;
    skipped: number;
    errors: number;
  } | null;
  nextCursor: number | null;
  hasMore: boolean;
}
```

### 4. Implement component

```tsx
function BulkDraftRegenerationCard() {
  const [state, setState] = useState<RegenerateAllState>({
    channel: "email",
    isRunning: false,
    progress: null,
    nextCursor: null,
    hasMore: false,
  });

  const handleRegenerate = async () => {
    setState(s => ({ ...s, isRunning: true }));

    try {
      const result = await regenerateAllDrafts(
        clientId,
        state.channel,
        { cursor: state.nextCursor ?? undefined }
      );

      if (result.success) {
        setState(s => ({
          ...s,
          isRunning: false,
          progress: {
            totalEligible: result.totalEligible,
            processedLeads: (s.progress?.processedLeads ?? 0) + result.processedLeads,
            regenerated: (s.progress?.regenerated ?? 0) + result.regenerated,
            skipped: (s.progress?.skipped ?? 0) + result.skipped,
            errors: (s.progress?.errors ?? 0) + result.errors,
          },
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        }));

        if (!result.hasMore) {
          toast.success(`Completed! Regenerated ${result.regenerated} drafts.`);
        }
      } else {
        toast.error(result.error ?? "Failed to regenerate drafts");
        setState(s => ({ ...s, isRunning: false }));
      }
    } catch (error) {
      toast.error("An error occurred while regenerating drafts");
      setState(s => ({ ...s, isRunning: false }));
    }
  };

  const handleReset = () => {
    setState({
      channel: state.channel,
      isRunning: false,
      progress: null,
      nextCursor: null,
      hasMore: false,
    });
  };

  // ... render UI
}
```

### 5. Admin-only gating

Check user role before rendering the card:

```tsx
// In the AI Personality tab section
{isWorkspaceAdmin && (
  <Card>
    <CardHeader>
      <CardTitle>Bulk Regenerate AI Drafts</CardTitle>
      <CardDescription>
        Regenerate AI drafts after updating persona or booking settings.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <BulkDraftRegenerationCard />
    </CardContent>
  </Card>
)}
```

### 6. UI components to use

- `Select` from shadcn/ui for channel dropdown
- `Button` for actions
- `Progress` from shadcn/ui for progress bar
- `Alert` for warning about bulk operation
- `Badge` for status counts (regenerated, skipped, errors)

### 7. Accessibility considerations

- Disable buttons during operation
- Show loading spinner/indicator
- Announce progress to screen readers
- Clear focus management after operations

## Output

- New `BulkDraftRegenerationCard` component in Settings → AI Personality tab
- Channel selector (SMS, Email, LinkedIn)
- Progress tracking with visual feedback
- Continue/Reset actions for pagination handling
- Admin-only access control

## Handoff

Subphase e will verify the complete implementation with lint, build, and manual testing of all three bugs/features.
