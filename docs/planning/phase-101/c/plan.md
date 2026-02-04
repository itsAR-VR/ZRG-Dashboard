# Phase 101c — Analytics Action (Counts by Channel/Outcome)

## Focus
Provide a server action that returns counts of AI draft outcomes by channel for a selected date window, scoped to accessible workspaces, with email limited to `AI_AUTO_SEND`.

## Inputs
- `AIDraft.responseDisposition` from Phase 101a/101b
- Window selection semantics from `components/dashboard/analytics-view.tsx` (from/to ISO)
- Existing patterns:
  - `actions/auto-send-analytics-actions.ts` (counts-only approach, `resolveClientScope`)
  - `actions/analytics-actions.ts` (auth + window params usage)

## Work
1. Create `actions/ai-draft-response-analytics-actions.ts`:
   - Export `getAiDraftResponseOutcomeStats(opts?: { clientId?: string | null; from?: string; to?: string })`
   - Enforce access via `resolveClientScope(clientId)` (from `lib/workspace-access.ts`)
   - Return type:
     ```ts
     export type AiDraftResponseOutcomeStats = {
       window: { from: string; to: string };
       byChannel: {
         email: { AUTO_SENT: number; APPROVED: number; EDITED: number; total: number };
         sms: { AUTO_SENT: number; APPROVED: number; EDITED: number; total: number };
         linkedin: { AUTO_SENT: number; APPROVED: number; EDITED: number; total: number };
       };
       total: { AUTO_SENT: number; APPROVED: number; EDITED: number; tracked: number };
     };
     ```

2. Query approach (Postgres via `prisma.$queryRaw`):
   ```sql
   SELECT
     d.channel,
     d."responseDisposition",
     count(distinct d.id)::int as count
   FROM "AIDraft" d
   JOIN "Lead" l ON l.id = d."leadId"
   LEFT JOIN "EmailCampaign" ec ON ec.id = l."emailCampaignId"
   WHERE l."clientId" IN (${scope.clientIds})
     AND d."responseDisposition" IS NOT NULL
     AND d."updatedAt" >= ${from}
     AND d."updatedAt" < ${to}
     AND (d.channel != 'email' OR ec."responseMode" = 'AI_AUTO_SEND')
   GROUP BY d.channel, d."responseDisposition"
   ```

3. Post-process rows into `byChannel` and `total` shape

## Validation (RED TEAM)
- Query returns empty array for workspaces with no tracked drafts (not an error)
- Email counts are zero when no AI_AUTO_SEND campaigns exist
- `npm run lint` passes

## Output
- Server action returning correct, scoped counts per window
- File added: `actions/ai-draft-response-analytics-actions.ts`

## Handoff
Proceed to Phase 101d to surface these counts in Analytics UI.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `getAiDraftResponseOutcomeStats` server action using scoped `count(distinct d.id)` grouped by channel + disposition, with email limited to `AI_AUTO_SEND`.
- Commands run:
  - None
- Blockers:
  - None
- Next concrete steps:
  - Wire the new action into `components/dashboard/analytics-view.tsx` and render the Analytics card (Phase 101d).
