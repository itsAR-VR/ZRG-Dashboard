# Phase 101d — Analytics UI Card

## Focus
Display the disposition breakdown in the Analytics page (Campaigns tab) for the currently selected date window.

## Inputs
- `getAiDraftResponseOutcomeStats` from Phase 101c
- Existing Analytics page patterns in `components/dashboard/analytics-view.tsx`
- Locked decisions: surface in Analytics, not Settings

## Work
1. Update `components/dashboard/analytics-view.tsx`:
   - Import: `import { getAiDraftResponseOutcomeStats, type AiDraftResponseOutcomeStats } from "@/actions/ai-draft-response-analytics-actions"`
   - Add state: `const [aiDraftOutcomeStats, setAiDraftOutcomeStats] = useState<AiDraftResponseOutcomeStats | null>(null)`
   - Add loading flag: `const [aiDraftOutcomeLoading, setAiDraftOutcomeLoading] = useState(true)`
   - In the existing `useEffect` that fetches analytics (around line 124):
     ```ts
     async function fetchAiDraftOutcomes() {
       setAiDraftOutcomeLoading(true)
       const result = await getAiDraftResponseOutcomeStats({
         clientId: activeWorkspace,
         ...windowParams,
       })
       if (!cancelled && result.success && result.data) {
         setAiDraftOutcomeStats(result.data)
       }
       setAiDraftOutcomeLoading(false)
     }
     fetchAiDraftOutcomes()
     ```

2. Render a new Card in `<TabsContent value="campaigns">` (after existing Auto-Send Analytics card):
   - Title: "AI Draft Response Outcomes"
   - Description: `${windowLabel} • Email counts are for AI_AUTO_SEND campaigns only`
   - Table layout:
     | Channel | Auto‑Sent | Approved | Edited | Total |
     |---------|-----------|----------|--------|-------|
     | Email   | {n}       | {n}      | {n}    | {n}   |
     | SMS     | {n}       | {n}      | {n}    | {n}   |
     | LinkedIn| {n}       | {n}      | {n}    | {n}   |
   - Empty state: "No tracked outcomes in this window" when `total.tracked === 0`
   - Loading state: show `<Loader2 className="animate-spin" />` while loading

## Validation (RED TEAM)
- Card renders without errors when data is null (loading/empty)
- Numbers update when date preset changes
- `npm run build` passes

## Output
- Analytics page shows outcome breakdown per window/channel

## Handoff
Proceed to Phase 101e to add tests and run validation gates.

