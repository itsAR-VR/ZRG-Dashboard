# Phase 37e — Touch Targets + Visual Consistency (Sizes, States, Contrast Check)

## Focus
Make key interactive controls easier to use (especially on touch devices) and visually consistent across the dashboard.

## Inputs
- WCAG 2.1: 2.5.5 (Target Size) — best-effort alignment (AA in 2.2; still a strong UX requirement)
- RED TEAM verified icon-button hotspots with small sizes:

| File | Issue | Current Size | Target |
|------|-------|--------------|--------|
| `components/dashboard/conversation-feed.tsx` | Jump buttons | `h-7 w-7` (28px) | `min-h-11 min-w-11` (44px) hit area |
| `components/dashboard/followup-sequence-manager.tsx` | Action buttons | `h-7 w-7` (28px) | `min-h-11 min-w-11` (44px) hit area |
| `components/dashboard/settings/booking-process-manager.tsx` | Stage controls | `h-8 w-8` (32px) | `min-h-11 min-w-11` (44px) hit area |
| `components/dashboard/crm-view.tsx` | Navigation buttons | `h-7 w-7` (28px) | `min-h-11 min-w-11` (44px) hit area |

## Work

### Step 1: Define the touch target strategy

**WCAG 2.5.5 Target Size (Enhanced)** recommends 44×44px minimum.
**WCAG 2.1 Level AA** (current target) has no strict minimum but recommends 24×24px.

**Strategy decision (confirmed 2026-01-18):**
Use **padding-based hit-area expansion** approach:
- Keep icon visually small (16-20px)
- Expand clickable area to 44×44px via padding
- Use `min-h-11 min-w-11` (Tailwind 44px) with centered icon

### Step 2: Fix conversation-feed.tsx jump buttons

**Current pattern (~line 309):**
```tsx
<Button variant="ghost" size="icon" className="h-7 w-7" ...>
  <ChevronUp className="h-4 w-4" />
</Button>
```

**Fixed pattern:**
```tsx
<Button
  variant="ghost"
  size="icon"
  className="min-h-11 min-w-11"
  aria-label="Jump to top"
>
  <ChevronUp className="h-4 w-4" />
</Button>
```

Apply to both jump buttons (lines ~309, ~318).

### Step 3: Fix followup-sequence-manager.tsx action buttons

**Locations:**
- Line ~431: Play/pause button → `className="min-h-11 min-w-11"`
- Line ~443: Edit button → `className="min-h-11 min-w-11"`
- Line ~450: Delete button → `className="min-h-11 min-w-11"`
- Line ~613: Delete step button → `className="min-h-11 min-w-11"`

### Step 4: Fix booking-process-manager.tsx stage controls

**Locations:**
- Line ~626: Move up → `className="min-h-11 min-w-11"`
- Line ~634: Move down → `className="min-h-11 min-w-11"`
- Line ~642: Remove → `className="min-h-11 min-w-11"`

### Step 5: Fix crm-view.tsx navigation buttons

**Locations:**
- Line ~643: Jump to top → `className="min-h-11 min-w-11"`
- Line ~646: Jump to bottom → `className="min-h-11 min-w-11"`

### Step 6: Verify hover/active/disabled states

For each modified button:
1. Verify hover state exists (background change)
2. Verify active/pressed state exists
3. Verify disabled state (if applicable) is visually distinct and non-interactive

### Step 7: Spot-check contrast

Review muted text with heavy opacity (e.g., `text-muted-foreground/60`):
- Check against background in light and dark modes
- Target: 4.5:1 contrast ratio for normal text, 3:1 for large text

**Common issues to check:**
- Placeholder text in inputs
- Disabled button text
- Secondary labels

**Note:** Only adjust if clearly insufficient; avoid unnecessary contrast bumps that affect design intent.

### Step 8: Validation

```bash
npm run lint
npm run build
```

Manual tests:
1. On mobile/touch device (or DevTools touch emulation): tap each icon button → reliable activation
2. Visual inspection: buttons have consistent sizes, hover states work
3. Contrast check: use browser DevTools or axe-core for automated contrast warnings

### Step 9: Run Impeccable Design Skills

**9a. `/impeccable:harden`** — Final hardening pass:
- Verify touch targets work across all interactive states (loading, disabled, error)
- Check hover/active states don't break on touch devices
- Validate no regressions in existing functionality

**9b. `/impeccable:adapt`** — Cross-device validation:
- Test touch targets on mobile viewport (375px, 768px, 1024px)
- Verify focus rings are visible at all breakpoints
- Check button spacing doesn't cause overlap on narrow screens

**9c. `/impeccable:bolder`** (if needed) — Visual amplification:
- Only invoke if a11y fixes made UI feel too "safe" or generic
- Use to add micro-interactions, enhance visual hierarchy, or amplify focus states

**9d. `/frontend-design`** (if needed) — Visual polish:
- Only invoke if contrast issues are found in Step 7
- Use for any visual state refinements (hover, active, disabled styling)

### Step 10: Run `/optimize` — Performance Audit

After all a11y changes are complete, run performance checks:

**What to measure:**
- Bundle size impact (should be negligible — only DOM attributes added)
- Render performance (new onKeyDown handlers shouldn't cause re-renders)
- Animation frame rate (verify 60fps maintained)

**Performance checklist:**
- [ ] No new dependencies added
- [ ] No expensive computations in event handlers
- [ ] Memoization preserved on modified components
- [ ] Animations still run at 60fps (Chrome DevTools Performance panel)

### Step 11: Animation Preservation Check

Verify Insights animations weren't broken by a11y fixes:

```bash
# Test these animation classes still work:
# - .insights-message-enter (message slide-in)
# - .insights-thinking-pulse (thinking state)
# - .insights-session-enter (session list stagger)
```

**Manual tests:**
1. Open Insights → send message → verify message slides in
2. Wait for response → verify thinking animation plays
3. Create new session → verify session appears with stagger animation
4. Enable `prefers-reduced-motion` in OS → verify animations are disabled

## Output

**Completed 2026-01-18**

Expanded touch targets to ~44×44px (`min-h-11 min-w-11`) on icon buttons across 4 files:

1. **`components/dashboard/conversation-feed.tsx`** (2 buttons):
   - Jump to top, Jump to bottom buttons

2. **`components/dashboard/followup-sequence-manager.tsx`** (5 buttons):
   - Collapsible trigger (expand/collapse sequence)
   - Play/pause, Edit, Delete sequence buttons
   - Delete step button

3. **`components/dashboard/settings/booking-process-manager.tsx`** (6 buttons):
   - Edit, Duplicate, Delete booking process buttons
   - Move up, Move down, Remove stage buttons

4. **`components/dashboard/crm-view.tsx`** (2 buttons):
   - Jump to top, Jump to bottom buttons in leads table

**Notes:**
- Used `min-h-11 min-w-11` (44px) to expand hit areas while keeping icon visually small (16px)
- Changed `gap-2` to `gap-1` on some button groups to reduce visual spacing after size increase
- Hover/active/disabled states are inherited from the Button component - no changes needed

- `npm run lint --quiet` passes (no errors)

## Handoff
Proceed to Phase 37f to add workspace-wide animations and micro-interactions.

---

## Validation (RED TEAM)

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Touch targets are ~44×44px (verify with DevTools element inspector)
- [ ] Hover/active states are present on all modified buttons
- [ ] No critical contrast failures flagged by axe-core DevTools extension

## Assumptions / Open Questions (RED TEAM)

- Assumption: `min-h-11 min-w-11` (44px) on icon buttons is the default for key icon-only actions (confidence ≥90%)
  - Mitigation: If visual density suffers in any specific area, keep the hit area but reduce perceived size via:
    - removing explicit height/width classes that shrink the visible button chrome
    - tightening surrounding layout spacing (not the hit target)
- Assumption: Contrast spot-check is sufficient; full audit deferred to future phase (confidence ≥90%)
  - Rationale: Phase 37 scope is a11y + visual polish pass, not full WCAG audit
  - Mitigation: Log any contrast issues found as tech debt for Phase 38+

---

## Subphase e Close-Out

After completing subphase e (before moving to f):

- [ ] `npm run lint` — no errors
- [ ] `npm run build` — succeeds
- [ ] Touch targets verified at ~44×44px
- [ ] Hover/active states present on modified buttons

**Note:** Full Phase 37 close-out happens after subphase f (animations).
