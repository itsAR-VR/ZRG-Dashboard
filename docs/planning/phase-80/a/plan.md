# Phase 80a — Bug Fix: "Meeting Booked" Draft Generation

## Focus

Fix the immediate bug where leads marked with `sentimentTag: "Meeting Booked"` do not receive AI-generated drafts. This causes hot leads (like Ari Feingold) who provide specific meeting times to go unanswered.

## Inputs

- Root cause analysis from Phase 80 plan
- Current `shouldGenerateDraft()` function at `lib/ai-drafts.ts:2450-2460`
- `POSITIVE_SENTIMENTS` array in `lib/sentiment-shared.ts:40-45`

## Work

1. **Read current implementation:**
   - `lib/ai-drafts.ts` — `shouldGenerateDraft()` function
   - `lib/sentiment-shared.ts` — `POSITIVE_SENTIMENTS` constant

2. **Decision: Where to add "Meeting Booked":**
   - Option A: Add to `POSITIVE_SENTIMENTS` array — affects other usages (lead assignment, etc.)
   - Option B: Add specific check in `shouldGenerateDraft()` — targeted fix
   - **Recommendation:** Option B — targeted fix to avoid side effects

3. **Implement fix:**
   ```typescript
   export function shouldGenerateDraft(sentimentTag: string, email?: string | null): boolean {
     if (isBounceEmailAddress(email)) {
       return false;
     }

     const normalized = sentimentTag === "Positive" ? "Interested" : sentimentTag;

     // NEW: Also generate drafts for "Meeting Booked" leads (they may need scheduling help)
     if (normalized === "Meeting Booked") {
       return true;
     }

     return normalized === "Follow Up" || isPositiveSentiment(normalized);
   }
   ```

4. **Verify:**
   - `npm run lint`
   - `npm run build`

## Output

- Updated `lib/ai-drafts.ts` so `shouldGenerateDraft()` returns true for `"Meeting Booked"` after normalization.
- Lint/build not run yet (defer to end of phase for consolidated checks).

## Coordination Notes

**Potential overlap:** Phase 79 also plans edits to `lib/ai-drafts.ts` (draft generation logic).  
**Action:** Re-read and merge carefully if Phase 79 is executed later.

## Handoff

With draft generation fixed, proceed to Phase 80b to add schema fields for configurable auto-send scheduling.
