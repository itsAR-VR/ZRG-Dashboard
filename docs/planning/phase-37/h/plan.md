# Phase 37h — Label Search/Filter Inputs + Select Triggers (Dashboard-Wide)

## Focus
Eliminate placeholder-only labeling for dashboard search/filter controls by adding programmatic labels (`aria-label`, `aria-labelledby`, or visible `<Label htmlFor>` + `id`), prioritizing high-traffic filter bars.

## Inputs
- WCAG 2.1: 1.3.1 (Info and Relationships), 3.3.2 (Labels or Instructions)
- RED TEAM verified unlabeled controls (examples):
  - `components/dashboard/crm-view.tsx`: Search leads input, Status filter select
  - `components/dashboard/conversation-feed.tsx`: Search conversations input, Sort select
  - `components/dashboard/sidebar.tsx`: Workspace search input inside dropdown

## Work
### Step 1: Establish the labeling pattern for “search bars”
- When a visible label would add clutter, prefer `aria-label`:
  - `aria-label="Search leads"`
  - `aria-label="Search conversations"`
  - `aria-label="Search workspaces"`
- Keep placeholder text as supportive hint text, not the only label.

### Step 2: Label Select triggers used as filters
Radix/shadcn `Select` uses a trigger button; attach the label to the trigger:
- Add `aria-label` to `SelectTrigger`, e.g.:
  - `aria-label="Filter leads by status"`
  - `aria-label="Sort conversations"`

### Step 3: Expand inventory beyond the known hotspots
- Quick scan for additional `<Input placeholder=...>` and filter `<SelectTrigger>` in `components/dashboard/**` that lack a nearby label or `aria-label`.
- Prioritize: Inbox/Conversation filters, CRM filters, Settings search fields, dropdown search fields.

### Step 4: Validation (RED TEAM)
- Run: `npm run lint` and `npm run build`.
- Manual: browser DevTools Accessibility panel → “Form controls” show names (no “unlabeled” warnings).
- Manual: screen reader spot-check → controls announce purpose (not just “edit text”).

## Output
- Dashboard filter/search controls are programmatically labeled.
- Reduced reliance on placeholder-only instructions.

## Handoff
Phase 37 can close after completing a–h and running the validation checklist in the root plan.

