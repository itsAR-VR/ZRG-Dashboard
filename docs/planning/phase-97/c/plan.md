# Phase 97c — Auto-Send Stats (Action + UI)

## Focus
Add minimal, safe analytics so operators can quantify auto-send behavior without needing DB access.

## Inputs
- Existing analytics patterns: `actions/analytics-actions.ts` (uses `requireAuthUser()`, `accessibleClientWhere`)
- Existing campaign actions: `actions/email-campaign-actions.ts`
- Auto-send decision fields on `AIDraft`: `autoSendAction`, `autoSendConfidence`, `autoSendThreshold`, `autoSendReason`, `autoSendEvaluatedAt` (indexed)
- Message fields: `sentBy`, `source`, `aiDraftId`, `direction`
- Campaign panel: `components/dashboard/settings/ai-campaign-assignment.tsx`

## Work

### Step 1: Create new server action file

Create `actions/auto-send-analytics-actions.ts`:

```ts
"use server";

import prisma from "@/lib/prisma";
import { requireAuthUser } from "@/lib/workspace-access";
import { accessibleClientWhere } from "@/lib/workspace-access-filters";

export type AutoSendStats = {
  campaignCounts: {
    aiAutoSend: number;
    setterManaged: number;
    total: number;
  };
  draftCounts: {
    sendImmediate: number;
    sendDelayed: number;
    needsReview: number;
    skip: number;
    error: number;
  };
  aiSentMessageCount: number;
  windowDays: number;
};

export async function getAutoSendStats(opts: {
  clientId: string;
  days?: number;
}): Promise<{ success: boolean; data?: AutoSendStats; error?: string }> {
  try {
    const user = await requireAuthUser();
    const days = Math.min(Math.max(opts.days ?? 30, 1), 90); // Clamp 1-90 days
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Verify workspace access
    const client = await prisma.client.findFirst({
      where: { id: opts.clientId, ...accessibleClientWhere(user.id) },
      select: { id: true },
    });

    if (!client) {
      return { success: false, error: "Workspace not found or access denied" };
    }

    // 1. Campaign counts by responseMode
    const campaignAgg = await prisma.emailCampaign.groupBy({
      by: ["responseMode"],
      where: { clientId: opts.clientId },
      _count: true,
    });

    const campaignCounts = {
      aiAutoSend: 0,
      setterManaged: 0,
      total: 0,
    };
    for (const row of campaignAgg) {
      const count = row._count;
      campaignCounts.total += count;
      if (row.responseMode === "AI_AUTO_SEND") {
        campaignCounts.aiAutoSend += count;
      } else {
        campaignCounts.setterManaged += count;
      }
    }

    // 2. Draft counts by autoSendAction for AI_AUTO_SEND campaigns in window
    // First get campaign IDs that are AI_AUTO_SEND
    const aiCampaignIds = await prisma.emailCampaign.findMany({
      where: { clientId: opts.clientId, responseMode: "AI_AUTO_SEND" },
      select: { id: true },
    });
    const campaignIdSet = new Set(aiCampaignIds.map((c) => c.id));

    // Get leads in those campaigns
    const leadsInAiCampaigns = await prisma.lead.findMany({
      where: {
        clientId: opts.clientId,
        emailCampaignId: { in: Array.from(campaignIdSet) },
      },
      select: { id: true },
    });
    const leadIdSet = new Set(leadsInAiCampaigns.map((l) => l.id));

    // Count drafts by autoSendAction
    const draftAgg = await prisma.aIDraft.groupBy({
      by: ["autoSendAction"],
      where: {
        clientId: opts.clientId,
        leadId: { in: Array.from(leadIdSet) },
        channel: "email",
        autoSendEvaluatedAt: { gte: since },
      },
      _count: true,
    });

    const draftCounts = {
      sendImmediate: 0,
      sendDelayed: 0,
      needsReview: 0,
      skip: 0,
      error: 0,
    };
    for (const row of draftAgg) {
      const count = row._count;
      const action = row.autoSendAction;
      if (action === "send_immediate") draftCounts.sendImmediate += count;
      else if (action === "send_delayed") draftCounts.sendDelayed += count;
      else if (action === "needs_review") draftCounts.needsReview += count;
      else if (action === "skip") draftCounts.skip += count;
      else if (action === "error") draftCounts.error += count;
    }

    // 3. Count AI-sent messages in window
    const aiSentMessageCount = await prisma.message.count({
      where: {
        lead: {
          clientId: opts.clientId,
          emailCampaignId: { in: Array.from(campaignIdSet) },
        },
        direction: "outbound",
        sentBy: "ai",
        source: "zrg",
        aiDraftId: { not: null },
        sentAt: { gte: since },
      },
    });

    return {
      success: true,
      data: {
        campaignCounts,
        draftCounts,
        aiSentMessageCount,
        windowDays: days,
      },
    };
  } catch (error) {
    console.error("[getAutoSendStats] Error:", error);
    return { success: false, error: "Failed to load auto-send stats" };
  }
}
```

### Step 2: Add stats display to campaign panel

In `components/dashboard/settings/ai-campaign-assignment.tsx`:

**Add import:**
```tsx
import { getAutoSendStats, type AutoSendStats } from "@/actions/auto-send-analytics-actions";
```

**Add state:**
```tsx
const [stats, setStats] = useState<AutoSendStats | null>(null);
const [statsLoading, setStatsLoading] = useState(false);
```

**Load stats in `load()` callback (parallel with campaigns):**
```tsx
const [campaignsRes, bookingRes, personasRes, statsRes] = await Promise.all([
  getEmailCampaigns(activeWorkspace),
  listBookingProcesses(activeWorkspace),
  listAiPersonas(activeWorkspace),
  getAutoSendStats({ clientId: activeWorkspace }),
]);

// ... existing handling ...

if (statsRes.success && statsRes.data) {
  setStats(statsRes.data);
} else {
  setStats(null);
}
```

**Add stats display in header (after the existing badges, before Refresh button):**
```tsx
{stats && (
  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span className="font-medium">Last {stats.windowDays}d:</span>
    <span>AI sent {stats.aiSentMessageCount}</span>
    <span>·</span>
    <span>Review {stats.draftCounts.needsReview}</span>
    <span>·</span>
    <span>Scheduled {stats.draftCounts.sendDelayed}</span>
    {stats.draftCounts.skip > 0 && (
      <>
        <span>·</span>
        <span>Skipped {stats.draftCounts.skip}</span>
      </>
    )}
  </div>
)}
```

### Step 3: Handle loading state

Show a skeleton or "--" while stats are loading:
```tsx
{statsLoading ? (
  <span className="text-xs text-muted-foreground">Loading stats…</span>
) : stats ? (
  // stats display as above
) : null}
```

## Validation (RED TEAM)

1. **Prisma query check:** Verify indexes are used:
   - `AIDraft.autoSendEvaluatedAt` (indexed)
   - `AIDraft.autoSendAction` (indexed)
   - `Lead.emailCampaignId` (indexed via FK)
2. **Auth check:** Call `getAutoSendStats` without auth → expect "access denied" error.
3. **Count accuracy:** Manually verify counts against DB queries in Prisma Studio.
4. **Build check:** `npm run build` passes.
5. **Lint check:** `npm run lint` passes.

## Output
- New action file: `actions/auto-send-analytics-actions.ts`
- Action returns stable stats payload: campaign counts, draft counts by action, AI-sent message count.
- Campaign assignment panel surfaces stats so "extent" is visible without SQL.

### Completed (2026-02-03)
- Added `getAutoSendStats(clientId, { days })` server action returning counts-only stats (campaigns, drafts-by-action including `unevaluated`, AI-sent outbound email count). (`actions/auto-send-analytics-actions.ts`)
- Surfaced a compact “Last 30d” line in the campaign assignment panel. (`components/dashboard/settings/ai-campaign-assignment.tsx`)

## Handoff
Proceed to Phase 97d to add tests for evaluator interpretation + a manual QA checklist matching the Jam repro.
