# Phase 70c — Sidebar Filters + Query Logic

## Focus

Add "AI Sent" and "AI Needs Review" filter options to the dashboard sidebar and implement the query logic in `getConversationsCursor()` and `getInboxCounts()`.

## Inputs

- 70b: Auto-send evaluation data now persisted to `AIDraft.autoSendAction`
- Current sidebar implementation in `components/dashboard/sidebar.tsx`
- Current filter logic in `actions/lead-actions.ts`

## Work

### 1. Add filter items to sidebar (`components/dashboard/sidebar.tsx`)

```typescript
import { Bot, AlertCircle } from "lucide-react";

const filterItems = [
  // ... existing filters ...
  { id: "ai_sent", label: "AI Sent", icon: Bot, count: counts?.aiSent ?? 0, variant: "outline" as const },
  { id: "ai_review", label: "AI Needs Review", icon: AlertCircle, count: counts?.aiReview ?? 0, variant: "outline" as const },
];
```

### 2. Add filter counts (`actions/lead-actions.ts` → `getInboxCounts()`)

Add to the raw SQL count query:

```sql
-- AI Sent (drafts that were auto-sent)
count(distinct l.id) filter (
  where exists (
    select 1 from "AIDraft" d
    where d."leadId" = l.id
    and d."autoSendAction" in ('send_immediate', 'send_delayed')
  )
)::int as "aiSent",

-- AI Needs Review (drafts pending review)
count(distinct l.id) filter (
  where exists (
    select 1 from "AIDraft" d
    where d."leadId" = l.id
    and d."autoSendAction" = 'needs_review'
    and d.status = 'pending'
  )
)::int as "aiReview"
```

### 3. Add filter query logic (`actions/lead-actions.ts` → `getConversationsCursor()`)

```typescript
if (filter === "ai_sent") {
  whereConditions.push({
    aiDrafts: {
      some: {
        autoSendAction: { in: ["send_immediate", "send_delayed"] },
      },
    },
  });
} else if (filter === "ai_review") {
  whereConditions.push({
    aiDrafts: {
      some: {
        autoSendAction: "needs_review",
        status: "pending",
      },
    },
  });
}
```

### 4. Update types for new count fields

Add `aiSent` and `aiReview` to the `InboxCounts` interface.

## Output

- Sidebar displays "AI Sent" and "AI Needs Review" with badge counts
- Clicking filters shows only matching leads
- Counts update in real-time

## Handoff

Pass to 70d. The filter is functional; now add confidence/reason display to draft cards.
