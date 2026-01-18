# Phase 37g — Booking Process Click Targets (Templates/Stages) + Keyboard

## Focus
Fix remaining non-semantic click targets in the Booking Process UI so template selection and wave expand/collapse work via keyboard with visible focus.

## Inputs
- File: `components/dashboard/settings/booking-process-manager.tsx`
- WCAG 2.1: 2.1.1 (Keyboard), 2.4.7 (Focus Visible), 4.1.2 (Name, Role, Value)
- RED TEAM verified click targets:
  - Template cards: `<div className="... cursor-pointer" onClick={...}>`
  - Wave header: `<div className="... cursor-pointer" onClick={...}>` with nested icon buttons inside

## Work
### Step 1: Fix template selection cards (convert to semantic button)
- Convert each template “card” container to a `<button type="button">` since it contains no nested interactive controls.
- Preserve layout by applying existing classes plus `w-full text-left bg-transparent` and a focus-visible ring.
- Add an accessible name (visible text exists; if needed, add `aria-label` like `Create booking process from template: <name>`).

### Step 2: Fix wave header expand/collapse (keep container, add keyboard semantics)
The wave header contains nested icon buttons (move up/down/remove), so wrapping everything in a `<button>` would be invalid.

- Keep the header container element but add:
  - `role="button"`, `tabIndex={0}`
  - `onKeyDown` for Enter/Space to toggle
  - `aria-expanded={expanded}`
  - `aria-controls="<id>"` pointing to the wave content container
  - `className` focus styling (`focus-visible:ring-2 focus-visible:ring-ring`)
- Ensure nested icon buttons continue to `stopPropagation()` and remain focusable.

### Step 3: Validation (RED TEAM)
- Keyboard:
  - Tab to a template card → focus visible → Enter selects template.
  - Tab to wave header → focus visible → Enter/Space toggles expand/collapse.
  - Tab to nested move/remove buttons → they activate without toggling the wave.
- Run: `npm run lint` and `npm run build`.

## Output
- Booking templates and wave header are keyboard-accessible with visible focus.
- No nested-interactive-inside-button violations introduced.

## Handoff
Proceed to Phase 37h to label search/filter inputs and Select triggers across dashboard surfaces.

