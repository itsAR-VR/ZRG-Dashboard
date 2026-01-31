# Phase 70d — Draft Card UI (Display Confidence + Reasoning)

## Focus

Display the auto-send confidence score and reasoning on draft cards in the conversation view, with visual indicators for "AI Sent" vs "Needs Review" status.

## Inputs

- 70c: Filters functional, `autoSendAction` queryable
- Current draft display in `components/dashboard/conversation-card.tsx` or related
- `AIDraft` now includes `autoSendConfidence`, `autoSendReason`, `autoSendAction`

## Work

### 1. Fetch auto-send fields in draft queries

Update any queries that fetch `AIDraft` to include:
- `autoSendConfidence`
- `autoSendReason`
- `autoSendAction`
- `autoSendEvaluatedAt`

### 2. Add visual indicators to draft card

```tsx
{/* Needs Review indicator */}
{draft.autoSendAction === "needs_review" && (
  <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950 rounded-md text-sm border border-amber-200 dark:border-amber-800">
    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
      <AlertCircle className="h-4 w-4" />
      <span className="font-medium">
        Needs Review (Confidence: {Math.round((draft.autoSendConfidence ?? 0) * 100)}%)
      </span>
    </div>
    {draft.autoSendReason && (
      <p className="mt-1 text-amber-600 dark:text-amber-400 text-xs">
        {draft.autoSendReason}
      </p>
    )}
  </div>
)}

{/* AI Sent indicator */}
{draft.autoSendAction && ["send_immediate", "send_delayed"].includes(draft.autoSendAction) && (
  <div className="mt-2 flex items-center gap-2 text-green-600 dark:text-green-400 text-xs">
    <CheckCircle className="h-3 w-3" />
    <span>AI Sent (Confidence: {Math.round((draft.autoSendConfidence ?? 0) * 100)}%)</span>
  </div>
)}
```

### 3. Add tooltip for full reasoning (if truncated)

Use Shadcn Tooltip component to show full reasoning on hover if the text is long.

### 4. Style consistency

- "Needs Review" → amber/yellow warning style
- "AI Sent" → green success style
- "Skip" / "Error" → gray/red as appropriate

## Output

- Draft cards visually indicate AI auto-send status
- Confidence percentage displayed prominently
- Reasoning shown for "Needs Review" drafts
- Clear visual distinction between sent vs pending review

## Handoff

Phase 70 complete. Run verification:
1. `npm run lint`
2. `npm run build`
3. Test filters in browser
4. Verify confidence/reason displays on drafts
