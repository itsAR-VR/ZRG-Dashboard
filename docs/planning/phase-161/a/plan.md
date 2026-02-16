# Phase 161a — Incident Evidence Packet + Timeline Reconstruction

## Focus
Build a reliable incident evidence packet from the new log export and deployment metadata before changing code.

## Inputs
- `zrg-dashboard-log-export-2026-02-16T16-16-06.json`
- `app/api/inbox/conversations/route.ts`
- deployment identifiers/domains captured in the export

## Work
1. Parse and cluster incident logs by:
   - timestamp window,
   - deployment id/domain,
   - status code,
   - request path and method.
2. Confirm whether errors are exclusively `503` on `/api/inbox/conversations` or include adjacent endpoints (`/api/inbox/counts`, `/api/inbox/conversations/[leadId]`).
3. Capture a timeline artifact:
   - first-seen / last-seen timestamps,
   - affected deployment(s),
   - request volume and frequency pattern.
4. Document gaps in current export fidelity (e.g., empty message fields) and list additional logs needed.

## Output
- Incident evidence packet with concrete counts/timeline and affected deployments.

## Handoff
Proceed to Phase 161b with confirmed signal boundaries and candidate trigger hypotheses.

