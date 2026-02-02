# Founders Club — Weighted Round-Robin Configuration

## Goal
Assign new **positive** email leads in this sequence (repeat):  
`Vee → JD → Vee → JD → Emar`  
Jon should receive **no new** assignments (existing assignments remain).

## Configuration Steps (UI)
1. Go to **Settings → Integrations → Assignments** for Founders Club.
2. **Setters**: ensure Vee, JD, Jon, Emar are all listed as SETTERs.
3. Enable **Round robin**.
4. Enable **Email leads only**.
5. Build the sequence (click to add, duplicates allowed):
   - `Vee, JD, Vee, JD, Emar`
6. Save.

## Verification Checklist
- Trigger 10 **positive** email leads (via webhook or manual sentiment update).
- Expected assignment order:  
  `Vee, JD, Vee, JD, Emar, Vee, JD, Vee, JD, Emar`
- Confirm Jon receives **0** new assignments.

## Monitoring
- When the configured sequence filters to empty (e.g., all configured setters removed), a Slack alert is sent to the workspace’s Notification Center Slack channels (deduped daily).
- Logs to watch:
  - `[LeadAssignment] No eligible setters in configured sequence for client <id>`
  - `[LeadAssignment] Failed to send sequence-empty alert: ...`

## Rollback
- Disable **Round robin**, or
- Clear the sequence and disable **Email leads only** to revert to default behavior.
