# Phase 12e — Per-Campaign Analytics + Weekly Report

## Focus
Add a date-ranged per-campaign KPI report for EmailBison campaigns, including meeting requested/booked rates and segmentation by industry/headcount where present. Provide a weekly report MVP.

## Inputs
- EmailCampaign + lead/message relations (campaign assignment)
- Sentiment tags (locked definitions for “positive replies” and “meetings requested”)
- Provider-aware booking helpers from Phase 12d
- Existing analytics endpoints/utilities (search keys: `analytics`, `getAnalytics`, `meetingsBooked`)

## Work
- Implement per-campaign analytics (date-ranged):
  - `positive_replies`
  - `meetings_requested`
  - `meetings_booked` (provider-aware)
  - Derived rates:
    - `meetings_booked / positive_replies`
    - `meetings_requested / positive_replies`
    - `meetings_booked / meetings_requested`
- Add segmentation where available:
  - Industry (unknown bucket when missing)
  - Employee headcount buckets (unknown bucket when missing; define bucket edges explicitly)
- Weekly report MVP:
  - Top campaigns by booking rate
  - Bottom campaigns by booking rate
  - “High positive replies, low booking” campaigns
  - Breakdown by sentiment category
  - Breakdown by industry/headcount where present
- Decide/report where this surfaces (API endpoint for dashboard page first; optional scheduled persistence later).

## Output
- Added lead fields needed for segmentation:
  - `prisma/schema.prisma`: `Lead.industry`, `Lead.employeeHeadcount` (+ indexes)
  - `app/api/webhooks/email/route.ts`: EmailBison enrichment now extracts and persists `industry` + `employee_headcount` custom variables when present
- Added date-ranged per-campaign analytics + weekly report (server action):
  - `actions/analytics-actions.ts`: `getEmailCampaignAnalytics({ clientId?, from?, to? })`
    - Per-campaign: positive replies, meetings requested, meetings booked (provider-aware), and derived rates
    - Weekly report: top/bottom campaigns by booking rate, high-positive/low-booking list, sentiment breakdown, booking rate by industry/headcount bucket
- Surfaced campaign KPIs in the dashboard:
  - `components/dashboard/analytics-view.tsx` now shows an “Email Campaign KPIs” table (defaults to last 7 days)

## Handoff
Subphase 12f uses the same underlying queries/joins to export leads + message threads for external analysis in ChatGPT.
