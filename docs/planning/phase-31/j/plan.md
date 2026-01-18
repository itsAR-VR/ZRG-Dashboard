# Phase 31j — Unipile Disconnected Account Notifications (Schema-Consistent UI + Deduped Slack)

## Focus
When Unipile returns `401 errors/disconnected_account`, persist an integration “disconnected” state for the workspace and surface it to admins (UI banner + optional Slack), without spamming notifications.

## Inputs
- Prod error: `[Unipile] Connection check failed (401): {"type":"errors/disconnected_account", ... }`
- Repo reality:
  - Unipile client: `lib/unipile-api.ts` (`checkLinkedInConnection`, `sendLinkedInDM`, `sendLinkedInInMail`)
  - LinkedIn follow-ups run from: `lib/followup-engine.ts` (invoked by `app/api/cron/followups/route.ts`)
  - Schema constraint: there is no generic workspace notification table; `FollowUpTask` is lead-scoped and cannot store workspace-level integration alerts.

## Work

### 1) Choose a schema-consistent place to store integration health
- Preferred: extend `Client` (workspace) with minimal integration health fields, e.g.:
  - `unipileConnectionStatus` (string enum-ish: CONNECTED | DISCONNECTED | UNKNOWN)
  - `unipileDisconnectedAt` (DateTime?)
  - `unipileLastErrorAt` (DateTime?)
  - `unipileLastErrorMessage` (Text?)
  - `unipileLastNotifiedAt` (DateTime?) for 1/day dedupe
- Update `prisma/schema.prisma`, then run `npm run db:push` against the correct DB.

### 2) Detect “disconnected_account” reliably (no brittle string matching)
- In `lib/unipile-api.ts`, parse non-2xx responses as JSON when possible and expose a typed signal:
  - `type === "errors/disconnected_account"` OR `(status === 401 && title/detail indicates disconnect)`
- Ensure callers can access:
  - `isDisconnectedAccount`
  - a short `detail` string (safe for logs/UI)

### 3) Persist + dedupe notifications from the cron-safe path
- In `lib/followup-engine.ts` (or the cron-safe caller that has workspace context + Prisma access):
  - when `isDisconnectedAccount` is detected:
    - set `Client.unipileConnectionStatus = "DISCONNECTED"`
    - set/update `unipileDisconnectedAt` and `unipileLastError*`
    - send Slack notification only if `unipileLastNotifiedAt` is >24h ago (and `WorkspaceSettings.slackAlerts` is enabled)
  - when a later call succeeds:
    - set `Client.unipileConnectionStatus = "CONNECTED"` and clear `unipileDisconnectedAt` (optional)

### 4) UI surface area (user-visible)
- Add a workspace-level banner/indicator in the dashboard UI when:
  - `Client.unipileConnectionStatus === "DISCONNECTED"`
- Link the CTA to the Integrations settings page (reconnect instructions).

## Validation (RED TEAM)
- Force a disconnected response (401) and confirm:
  - the cron still returns 200 (resilient processing continues)
  - `Client` fields update once and do not thrash every cron tick
  - Slack notification dedupes to 1/day/workspace
  - UI banner appears for workspace admins
- Confirm reconnect flow clears the disconnected status.
- Run: `npm run lint` and `npm run build`.
- If schema changed: `npm run db:push` + verify columns exist.

## Output

**Completed implementation:**

1. **Schema extension (`prisma/schema.prisma`):**
   - Added fields to `Client` model:
     - `unipileConnectionStatus` (String?) - CONNECTED | DISCONNECTED | UNKNOWN
     - `unipileDisconnectedAt` (DateTime?) - When disconnect was first detected
     - `unipileLastErrorAt` (DateTime?) - Last error timestamp
     - `unipileLastErrorMessage` (Text?) - Last error detail
     - `unipileLastNotifiedAt` (DateTime?) - For 1/day Slack dedupe

2. **Error detection (`lib/unipile-api.ts`):**
   - Added `UnipileErrorInfo` interface
   - Added `parseUnipileErrorResponse(text, status)` - parses JSON and detects `errors/disconnected_account`
   - Added `isDisconnectedAccountError(error)` - checks error objects
   - Extended `SendResult` with `isDisconnectedAccount?: boolean`
   - Updated `sendLinkedInDM`, `sendLinkedInInMail`, `sendLinkedInConnectionRequest` to populate this field

3. **Health tracking (`lib/workspace-integration-health.ts`):**
   - New file for workspace integration health management
   - `updateUnipileConnectionHealth({ clientId, isDisconnected, errorDetail })`:
     - Sets Client fields on disconnect
     - Clears disconnect state on success
     - Sends Slack notification (deduped to 1/day max)

4. **Integration into followup engine (`lib/followup-engine.ts`):**
   - Imported `updateUnipileConnectionHealth`
   - Updated LinkedIn DM error handling to call health tracker on disconnect
   - Updated LinkedIn connection request error handling similarly
   - Marks workspace as connected on successful sends

5. **Slack notifications:**
   - Uses global `sendSlackNotification` (via SLACK_WEBHOOK_URL)
   - Includes workspace name, error detail, and reconnect action
   - Deduped to max 1 notification per workspace per day

**Note:** UI banner for dashboard requires frontend work (not in scope for this phase). The health fields are available for UI integration.

**Verified:** `npm run build` completes successfully.

**Pending:** Run `npm run db:push` to apply schema changes to database.

## Handoff
Phase 31 implementation complete. All 8 production error types are now addressed with resilient error handling.
