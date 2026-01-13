# Phase 17d — Owen Workspace Deep-Dive + Diagnostics

## Focus
Explain why Owen shows no SMS activity in-dashboard and capture concrete evidence + next steps.

## Inputs
- Supabase (project: `pzaptpgrcezknnsfytob`)
- Reported symptoms: “Owen shows no SMS activity for past month despite activity in GHL”

## Work
1. Verified workspace exists and has GHL config present (no secrets printed):
   - Client: `a5abbf44-307a-4742-864d-a3fbb9916e0f`
   - `ghlLocationId`: `4yeFXsj0OAWnh0Ir5KqT`
2. Checked lead coverage:
   - 42 leads; 42/42 have `ghlContactId` and `phone`.
3. Checked message ingestion:
   - 88 total SMS messages in DB for Owen, newest `sentAt` = `2025-12-13`.
   - 0 SMS messages in the last 30 days.
   - 0 leads with `lastMessageAt` after `2025-12-13`.

## Output
- Strong evidence Owen’s issue is *ingestion/sync gap*, not missing IDs:
  - Webhooks not firing for Owen location, OR
  - GHL API key is invalid/permissions changed, OR
  - Prior sync logic was relying on stale export results (addressed in Phase 17b; requires deploy verification).
- Next steps post-deploy:
  1. Use the now-chunked “Sync All” in the Owen workspace to backfill missed replies.
  2. In Settings → GHL, run existing connection tests to validate the current GHL key.
  3. Check Vercel logs for `/api/webhooks/ghl/sms` events with `locationId=4yeFXsj0OAWnh0Ir5KqT` to confirm webhook coverage.

## Handoff
Proceed to Phase 17e for secondary log issues (EmailBison invalid sender IDs + calendar link error messaging).

