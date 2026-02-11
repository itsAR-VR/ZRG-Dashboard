# Phase 137 — Skill Assignment Matrix (Multi-Check Validated)

## Validation Protocol
This matrix was produced with a 3-check subagent workflow:
1. Section specialists (parallel):
   - Settings specialist
   - Inbox + navigation specialist
   - CRM/Analytics/Insights specialist
2. Coverage validator:
   - Checked each core surface for primary + verification skill coverage
3. Appropriateness validator:
   - Corrected skill order where UX impact/speed sequencing was weaker

## Subagent Re-Check (2026-02-11)
Parallel explorers re-audited `action-station`, `settings-view` (General), and `crm-drawer` after initial 137c/137d changes.

- `components/dashboard/action-station.tsx`
  - Top risks: send-on-enter races during async operations, stale draft responses, compose overwrite risk.
  - Updated routing: `impeccable-harden` -> `impeccable-clarify` -> `impeccable-optimize`.
- `components/dashboard/settings-view.tsx` (General)
  - Top risks: missing label associations, eager non-tab-gated fetches, responsive tab compression.
  - Updated routing emphasis: `impeccable-harden` + `impeccable-optimize` before final polish.
- `components/dashboard/crm-drawer.tsx`
  - Top risks: null crash path (`workspaceName.toLowerCase()`), stale booking state between leads, missing accessible names.
  - Updated routing: `impeccable-harden` -> `impeccable-rams` -> `impeccable-optimize`.

## Execution Delta (2026-02-11 08:18)
Applied fixes with explicit skill routing on active surfaces:

- `components/dashboard/inbox-view.tsx`
  - `impeccable-harden`: added stale async response guard in active conversation fetch path.
  - `impeccable-rams`: added SR-only live status announcements for updating/live badges.
- `components/dashboard/action-station.tsx`
  - `impeccable-harden`: IME-safe Enter handling to avoid accidental sends.
  - `impeccable-clarify`: explicit email-recipient guidance when lead email is missing.
  - `impeccable-rams`: recipient field labeling/described-by associations.
  - `impeccable-polish`: stable “Compose with AI” affordance during draft loading.
- `components/dashboard/settings-view.tsx`
  - `impeccable-adapt`: horizontal overflow protection for wide observability/sentiment tables.
  - `impeccable-rams`: logo file-input helper association + Slack recipient toggle semantics.
- `components/dashboard/settings/integrations-manager.tsx`
  - `impeccable-adapt`: clients table horizontal overflow resilience.
  - `impeccable-rams`: Email Integration accordion semantics (`aria-expanded`, `aria-controls`).
- `components/dashboard/crm-view.tsx`
  - `impeccable-rams`: search/filter control labels.
  - `impeccable-adapt`: min-width safeguards for virtualized row layout on narrow viewports.
- `components/dashboard/analytics-view.tsx`
  - `impeccable-rams`: proper labels for custom date controls.
- `components/dashboard/insights-chat-sheet.tsx`
  - `impeccable-rams`: keyboard-accessible campaign row selection and selected-session state announcement.
  - `impeccable-optimize`: swapped non-layout-critical `useLayoutEffect` to `useEffect`.

## Skill Intent
- **First-pass skills**: establish safe/correct UX foundations.
  - Typical: `impeccable-rams`, `impeccable-critique`, `impeccable-harden`, `impeccable-normalize`
- **Second-pass skills**: improve structure, clarity, and resilience.
  - Typical: `impeccable-clarify`, `impeccable-harden`, `impeccable-critique`, `impeccable-optimize`
- **Final-pass skills**: finalize quality and ship-readiness.
  - Typical: `impeccable-optimize`, `impeccable-polish`, `impeccable-rams`, `impeccable-audit`

## Canonical Skill Routing by Surface

| Surface | First-pass | Second-pass | Final-pass | Supporting Impeccable Skills |
|---|---|---|---|---|
| `app/page.tsx` | `impeccable-rams` | `impeccable-harden` | `impeccable-polish` | `impeccable-adapt` |
| `components/dashboard/sidebar.tsx` | `impeccable-rams` | `impeccable-critique` | `impeccable-polish` | `impeccable-normalize`, `impeccable-quieter` |
| `components/dashboard/inbox-view.tsx` | `impeccable-harden` | `impeccable-clarify` | `impeccable-optimize` | `impeccable-simplify`, `impeccable-quieter` |
| `components/dashboard/conversation-feed.tsx` | `impeccable-rams` | `impeccable-critique` | `impeccable-optimize` | `impeccable-adapt`, `impeccable-animate` |
| `components/dashboard/action-station.tsx` | `impeccable-harden` | `impeccable-clarify` | `impeccable-optimize` | `impeccable-polish`, `impeccable-rams`, `impeccable-simplify` |
| `components/dashboard/crm-view.tsx` | `impeccable-harden` | `impeccable-optimize` | `impeccable-polish` | `impeccable-adapt` |
| `components/dashboard/crm-drawer.tsx` | `impeccable-harden` | `impeccable-rams` | `impeccable-optimize` | `impeccable-clarify`, `impeccable-adapt`, `impeccable-polish` |
| `components/dashboard/analytics-view.tsx` | `impeccable-clarify` | `impeccable-optimize` | `impeccable-rams` | `impeccable-colorize`, `impeccable-adapt` |
| `components/dashboard/analytics-crm-table.tsx` | `impeccable-harden` | `impeccable-optimize` | `impeccable-polish` | `impeccable-adapt` |
| `components/dashboard/insights-view.tsx` | `impeccable-clarify` | `impeccable-critique` | `impeccable-polish` | `impeccable-delight`, `impeccable-bolder` |
| `components/dashboard/insights-chat-sheet.tsx` | `impeccable-harden` | `impeccable-clarify` | `impeccable-optimize` | `impeccable-animate`, `impeccable-delight` |
| `components/dashboard/message-performance-panel.tsx` | `impeccable-harden` | `impeccable-clarify` | `impeccable-polish` | `impeccable-colorize`, `impeccable-bolder` |
| `components/dashboard/settings-view.tsx` (shell) | `impeccable-harden` | `impeccable-optimize` | `impeccable-polish` | `impeccable-rams`, `impeccable-clarify`, `impeccable-adapt` |
| `components/dashboard/settings/*.tsx` | `impeccable-harden` | `impeccable-clarify` | `impeccable-rams` | `impeccable-critique` (decision-heavy areas), `impeccable-optimize` (dense tables/dialogs) |

## Settings Sub-Area Routing

| Settings sub-area | First-pass | Second-pass | Final-pass | Supporting |
|---|---|---|---|---|
| Availability/schedule/holiday rules | `impeccable-harden` | `impeccable-clarify` | `impeccable-rams` | `impeccable-adapt` |
| Integrations credentials + connection tests | `impeccable-harden` | `impeccable-rams` | `impeccable-polish` | `impeccable-clarify` |
| Booking process manager + campaign assignment tables | `impeccable-harden` | `impeccable-optimize` | `impeccable-rams` | `impeccable-simplify` |
| AI persona + knowledge asset dialogs | `impeccable-harden` | `impeccable-clarify` | `impeccable-polish` | `impeccable-normalize` |
| Prompt editing/history dialogs | `impeccable-harden` | `impeccable-optimize` | `impeccable-rams` | `impeccable-simplify`, `impeccable-animate` (minimal) |
| Team/member management | `impeccable-harden` | `impeccable-rams` | `impeccable-polish` | `impeccable-clarify` |

## Mandatory Verification Checks Per Surface
- Run `impeccable-audit` at least once after first-pass fixes.
- Run `impeccable-rams` after any hardening/interaction changes.
- Run `impeccable-polish` only after behavior and resilience are stable.
- Re-run `impeccable-audit` delta at the end of Phase 137f to confirm issue-count reduction.
