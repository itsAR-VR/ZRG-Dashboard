# Phase 96d — Tests + UX + QA Checklist

## Focus
Ensure the new AI refresh path is safe, testable, and has good user feedback.

## Inputs
- Phase 96b: `applyReplacements` function (deterministic validation/apply layer)
- Phase 96a: `buildRefreshCandidates` function
- Phase 96c: wired server actions
- Existing UI: `components/dashboard/action-station.tsx:1130-1145` (refresh handler + toasts)

## Work

### Step 1: Unit tests for `applyReplacements`

Create `lib/__tests__/availability-refresh-ai.test.ts`:

```ts
describe("applyReplacements", () => {
  it("applies single replacement correctly", () => {
    const draft = "Meet me at 9:00 AM EST on Monday.";
    const replacements = [
      { startIndex: 12, endIndex: 32, oldText: "9:00 AM EST on Monday", newText: "2:00 PM PST on Tuesday" },
    ];
    expect(applyReplacements(draft, replacements)).toBe("Meet me at 2:00 PM PST on Tuesday.");
  });

  it("applies multiple non-overlapping replacements correctly", () => {
    const draft = "Available: 9:00 AM or 3:00 PM";
    const replacements = [
      { startIndex: 11, endIndex: 18, oldText: "9:00 AM", newText: "10:00 AM" },
      { startIndex: 22, endIndex: 29, oldText: "3:00 PM", newText: "4:00 PM" },
    ];
    expect(applyReplacements(draft, replacements)).toBe("Available: 10:00 AM or 4:00 PM");
  });

  it("rejects overlapping replacements", () => {
    const replacements = [
      { startIndex: 0, endIndex: 10, oldText: "0123456789", newText: "A" },
      { startIndex: 5, endIndex: 15, oldText: "5678901234", newText: "B" },
    ];
    expect(() => validateReplacements(replacements, draft)).toThrow(/overlap/i);
  });

  it("rejects out-of-bounds indices", () => {
    const draft = "Short";
    const replacements = [
      { startIndex: 0, endIndex: 100, oldText: "Short", newText: "Long" },
    ];
    expect(() => validateReplacements(replacements, draft)).toThrow(/bounds/i);
  });

  it("rejects mismatched oldText", () => {
    const draft = "Meet at 9:00 AM";
    const replacements = [
      { startIndex: 8, endIndex: 15, oldText: "10:00 AM", newText: "2:00 PM" },
    ];
    expect(() => validateReplacements(replacements, draft)).toThrow(/mismatch/i);
  });

  it("rejects newText not in candidates", () => {
    const candidates = [{ label: "2:00 PM EST", datetimeUtcIso: "2026-02-03T19:00:00Z" }];
    const replacements = [
      { startIndex: 8, endIndex: 15, oldText: "9:00 AM", newText: "3:00 PM PST" },
    ];
    expect(() => validateReplacementCandidates(replacements, candidates)).toThrow(/candidate/i);
  });
});
```

### Step 2: Unit tests for `buildRefreshCandidates`

Create `lib/__tests__/availability-refresh-candidates.test.ts`:

```ts
describe("buildRefreshCandidates", () => {
  it("excludes slots already in offeredSlots", async () => {
    // Mock dependencies and test exclusion logic
  });

  it("excludes slots on or before today in lead timezone", async () => {
    // Test with lead in EST, slots at 11 PM UTC (next day in UTC but same day in EST)
  });

  it("caps candidates at candidateCap", async () => {
    // Test with 100 available slots, cap of 50
  });

  it("returns empty array when no slots available", async () => {
    // Test with empty availability
  });

  it("ranks by offer count ascending", async () => {
    // Test that lower offer counts come first
  });
});
```

### Step 3: UX improvements in `action-station.tsx`

Update the toast messages in `handleRefreshAvailability`:

```tsx
const handleRefreshAvailability = async () => {
  if (!drafts.length) return;

  setIsRefreshingAvailability(true);

  const result = await refreshDraftAvailability(drafts[0].id, composeMessage);

  if (result.success && result.content) {
    const count = result.newSlots?.length || 0;
    if (count === 0) {
      toast.info("Availability times are already current");
    } else {
      toast.success(`Refreshed ${count} time${count === 1 ? "" : "s"}`);
    }
    setComposeMessage(result.content);
    setOriginalDraft(result.content);
    setDrafts(prev => prev.map(d =>
      d.id === drafts[0].id ? { ...d, content: result.content! } : d
    ));
  } else {
    // Distinguish between "no times found" and other errors
    if (result.error?.includes("No time options found")) {
      toast.warning(result.error);
    } else {
      toast.error(result.error || "Failed to refresh availability");
    }
  }

  setIsRefreshingAvailability(false);
};
```

### Step 4: Manual QA checklist

Create `docs/planning/phase-96/qa-checklist.md`:

```md
# Phase 96 QA Checklist

## Jam Scenario Reproduction
- [ ] Open the Jam report: https://jam.dev/c/55500533-fbe9-4fea-bb5a-d2b23a83e372
- [ ] Find a lead with a draft that has inline time offers (not structured section)
- [ ] Click Refresh availability
- [ ] Verify: times are swapped to valid future availability
- [ ] Verify: no error message "This draft doesn't contain availability times"

## Structured Section Refresh
- [ ] Find a lead with a draft containing `AVAILABLE TIMES:` bullet section
- [ ] Click Refresh availability
- [ ] Verify: section times are updated
- [ ] Verify: bullet format preserved

## Edge Cases
- [ ] Draft with no time offers at all
  - Expected: warning toast "No time options found in this draft to refresh..."
- [ ] Draft with all-valid time offers (future, in candidate list)
  - Expected: info toast "Availability times are already current"
- [ ] Draft with mixed inline + section times
  - Expected: all times refreshed
- [ ] Non-pending draft (approved/rejected)
  - Expected: error "Can only refresh availability for pending drafts"

## No Regressions
- [ ] Existing structured section refresh still works
- [ ] Toast messages are clear and actionable
- [ ] Button disabled during refresh (loading spinner shows)
- [ ] Refresh button position unchanged in action cluster

## Build Gates
- [ ] `npm run lint` — no new errors
- [ ] `npm run build` — succeeds
- [ ] Unit tests pass
```

### Step 5: Verification gates

```bash
npm run lint
npm run build
npm run test -- --testPathPattern="availability-refresh"
```

## Validation (RED TEAM)

- [ ] Tests cover the deterministic layer (not dependent on AI)
- [ ] Tests mock AI responses to verify validation logic
- [ ] QA checklist covers the Jam scenario exactly
- [ ] Error messages are user-friendly, not technical
- [ ] Build gates documented and run before merge

## Output
- Added tests:
  - `lib/__tests__/availability-refresh-ai.test.ts` (apply + validation checks).
  - `lib/__tests__/availability-refresh-candidates.test.ts` (filtering, offered-slot exclusion, cap, ranking, TZ token detection).
  - Registered both in `scripts/test-orchestrator.ts`.
- Exported `validateAvailabilityReplacements(...)` in `lib/availability-refresh-ai.ts` for deterministic validation tests.
- Updated `components/dashboard/action-station.tsx` to:
  - show info toast when no changes were needed,
  - show warning toast for “No time options found…” errors,
  - keep success toast for actual refreshes.
- QA checklist kept in this plan (no separate `qa-checklist.md` file created).
- Ran `npm run test` — pass (117 tests).
- Ran `npm run lint` — 0 errors, 22 warnings (existing baseline-browser-mapping + hooks/img warnings).
- Ran `npm run build` — success (baseline-browser-mapping warning emitted).

## Handoff
Phase 96 complete; proceed to root plan wrap-up (success criteria + phase summary updated with lint/build/test results).
