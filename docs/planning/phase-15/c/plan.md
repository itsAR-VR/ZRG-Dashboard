# Phase 15c — Analytics UI: Show Mode + Threshold

## Focus
Make Analytics reflect the campaign config clearly so operators can verify assignment at a glance.

## Inputs
- Existing KPI rows include `responseMode` and `autoSendConfidenceThreshold` (`actions/analytics-actions.ts`)
- UI: `components/dashboard/analytics-view.tsx` Email Campaign KPIs table

## Work
- Update the “Mode” column to display:
  - Setter-managed: “Setter”
  - AI auto-send: “AI ≥ {threshold%}”
- Keep the table compact and scannable.

## Output
- Analytics “Email Campaign KPIs” now reflects campaign assignment:
  - Mode column shows `Setter` for `SETTER_MANAGED`, or `AI ≥ {threshold}%` for `AI_AUTO_SEND`: `components/dashboard/analytics-view.tsx`.

## Handoff
Phase 15d: run `npm run lint` + `npm run build`, confirm campaign sync/webhooks do not overwrite mode/threshold, and update root plan success criteria + phase summary.
