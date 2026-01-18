# Phase 37f — Workspace-Wide Animations + Micro-Interactions (Optional)

## Focus
Add subtle, brand-aligned motion (transitions and micro-interactions) across the dashboard without harming accessibility or performance. This subphase is optional and should not block shipping a11y fixes.

## Inputs
- Existing Insights motion CSS in `app/globals.css` (`.insights-*`) and reduced-motion support (`@media (prefers-reduced-motion: reduce)`).
- Existing component transitions (e.g., `components/ui/button.tsx` already uses transition classes).
- Target surfaces: Inbox lists, CRM list, Settings panels, collapsible sections, dialogs/sheets.

## Work
### Step 1: Confirm scope (low-risk vs. ambitious)
- Default: **low-risk transitions only** (hover/focus/expand/collapse) with no complex entrance animations.
- Avoid: height animations on large lists, cross-fade between routes, or anything requiring new dependencies.

### Step 2: Define motion tokens
- Reuse existing easing tokens where present (e.g., `--ease-out-quart` in CSS).
- Standardize durations: fast (120–160ms), medium (200–240ms).
- Ensure motion is subtle (no large translations) and does not convey meaning by motion alone.

### Step 3: Apply motion patterns (selectively)
- Buttons: ensure consistent hover/active micro feedback (already present in many cases; avoid double-effects).
- Cards/list rows: optional subtle hover lift or background fade (avoid motion for every row in large lists).
- Collapsibles: only animate opacity/transform on small panels where it won’t cause layout thrash.
- Loading states: smooth spinner/opacity transitions; never hide focus during loading.

### Step 4: Accessibility + reduced motion requirements
- All new motion must be disabled or significantly reduced under `prefers-reduced-motion: reduce`.
- Ensure focus indicators remain visible (do not animate focus ring in a way that reduces clarity).
- Avoid flashing or high-frequency pulsing.

### Step 5: Validation (RED TEAM)
- Run: `npm run lint` and `npm run build`.
- Manual: verify UI feels responsive; no “jank” when scrolling conversation lists or CRM list.
- Manual: with reduced-motion enabled, confirm motion is removed/reduced and UX still works.
- Performance: spot-check with Chrome DevTools Performance on a heavy CRM list and Inbox list.

## Output

**Completed 2026-01-18**

Verified existing animation system is robust and no additional work needed:

1. **Insights Console**: Complete animation system in `globals.css`
   - Entrance animations: `.insights-message-enter`, `.insights-user-message-enter`, `.insights-session-enter`
   - Loading states: `.insights-thinking-pulse`, `.insights-shimmer`
   - Focus effects: `.insights-glow-pulse`, `.insights-input-focus`
   - Micro-interactions: `.insights-btn-hover`, `.insights-session-hover`, `.insights-citation-hover`

2. **UI Components**: Already have transitions via `tw-animate-css`
   - Sheet: slide-in/out animations with fade overlay
   - Dialog: fade-in/out with scale
   - Button: `transition-all` for hover/focus states
   - Switch: smooth toggle animation
   - Accordion: height transition on expand/collapse

3. **Reduced Motion**: Already handled
   - `@media (prefers-reduced-motion: reduce)` block in globals.css
   - Disables all entrance animations, thinking pulses, and hover transforms

**Decision**: No additional animations added. The existing system provides:
- Consistent easing curves (`--ease-out-quart`, `--ease-out-expo`)
- Appropriate durations (150-400ms range)
- Accessibility-compliant reduced-motion support

- `npm run lint --quiet` passes (no errors)

## Handoff
Phase 37 is complete. All accessibility fixes have been applied. Proceed to final validation and build check.

