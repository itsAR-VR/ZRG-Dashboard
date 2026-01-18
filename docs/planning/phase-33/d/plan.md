# Phase 33d — UI Display & Filtering

## Focus

Add lead score display to the inbox and CRM views, with filtering capabilities to prioritize high-score leads.

## Inputs

- Leads now have `fitScore`, `intentScore`, `overallScore` populated
- Existing inbox components in `components/dashboard/`
- Existing lead list and CRM views

## Work

1. **Create LeadScoreBadge component:**
   ```typescript
   // components/dashboard/lead-score-badge.tsx
   interface LeadScoreBadgeProps {
     score: number | null;  // null = unscored, 0 = Blacklist/opt-out, 1-4 = scored
     size?: 'sm' | 'md';
   }
   ```
   - Visual design: 1=red, 2=yellow, 3=green, 4=bright green/gold
   - Show score as "3" (overall only)
   - Unscored should render as `-` (no “null” text)
   - Disqualified leads are stored/displayed as score `1` (not `0`)
   - Reasoning is internal-only (do not show in UI)

2. **Add score to inbox lead list:**
   - Show LeadScoreBadge next to lead name/status
   - Show overall only (no fit/intent breakdown)

3. **Add score filter to inbox:**
   - Filter options: "All", "4 only", "3+", "2+", "1+", "Unscored", "Disqualified"
   - Persist filter in URL params for shareability
   - Consider combining with existing status filters

4. **Add score to CRM lead detail view:**
   - Show overall score only (fit/intent internal)
   - Show "Last scored: X" when `scoredAt` is present
   - Do not display reasoning

5. **Update lead queries:**
   - Add `overallScore` (and optionally `scoredAt`) to lead fetch queries used by Inbox + CRM
   - Support filtering by score in the server query (avoid client-only filtering)
   - Update `actions/crm-actions.ts` as needed

6. **Visual hierarchy:**
   - Score 4 leads should stand out (subtle highlight?)
   - Unscored leads should be visually neutral, not penalized

## Output

**Completed 2026-01-17:**

1. Created `components/dashboard/lead-score-badge.tsx`:
   - Displays score as badge with color coding (1=red, 2=amber, 3=green, 4=emerald)
   - Shows "-" for unscored (null) leads (and normalizes legacy `0` → `1`)
   - Native title tooltip for hover info
   - Supports sm/md sizes

2. Updated data types and actions:
   - Added `overallScore`, `scoredAt` to `Lead` interface in `lib/mock-data.ts`
   - Added `overallScore`, `scoredAt` to `ConversationData.lead` in `actions/lead-actions.ts`
   - Added `overallScore`, `scoredAt` to `CRMLeadData` in `actions/crm-actions.ts`
   - Updated all conversion functions to pass through scoring fields

3. Added score display to inbox:
   - Imported LeadScoreBadge in `components/dashboard/conversation-card.tsx`
   - Score badge shows next to lead name with tooltip

**Note:** Score filtering deferred to subphase e (Hardening) - will add filter dropdown to inbox.

## Handoff

Lead scores now display in the inbox. Subphase e will add score filtering, subphase f will add ICP settings UI, and subphase g will create the backfill script.
