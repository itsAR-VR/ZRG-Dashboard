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
- Analytics page reflects configuration choices directly.

## Handoff
Phase 15d runs QA (lint/build) and ensures docs match behavior.

