# Phase 133b — Server Action: Resolve EmailBison Reply URL

## Focus
Add a server action that returns the correct EmailBison UI deep link URL for a given lead ID, using workspace-specific base origin and safe reply UUID selection.

## Inputs
- Helpers from Phase 133a:
  - `resolveEmailBisonBaseUrl()`
  - `pickEmailBisonReplyUuidForDeepLink()`
- Workspace access enforcement: `requireLeadAccessById()`
- Provider guard: `resolveEmailIntegrationProvider()`
- EmailBison API fetch helper: `fetchEmailBisonReplies()` (or `fetchEmailBisonLeadReplies()` if preferred)

## Work
1. Add new server action file: `actions/emailbison-link-actions.ts`
2. Export:
   - `resolveEmailBisonReplyUrlForLead(leadId: string): Promise<{ success: boolean; url?: string; error?: string }>`
3. Implementation details (locked):
   - Enforce `requireLeadAccessById(leadId)` at the top.
   - Load lead + client snapshot via Prisma:
     - Lead: `id`, `emailBisonLeadId`
     - Client: `emailProvider`, `emailBisonApiKey`, `emailBisonWorkspaceId`, `smartLeadApiKey`, `smartLeadWebhookSecret`, `instantlyApiKey`, `instantlyWebhookSecret`, `emailBisonBaseHost.host`
   - Validate provider is `EMAILBISON` via `resolveEmailIntegrationProvider(clientSnapshot)`. If not, return a friendly error.
   - Require `client.emailBisonApiKey` and `lead.emailBisonLeadId`; return a friendly error if missing.
   - Fetch replies for the lead:
     - `fetchEmailBisonReplies(apiKey, lead.emailBisonLeadId, { baseHost: client.emailBisonBaseHost?.host ?? null })`
   - Determine preferred reply id for UUID selection:
     - Read the most recent EmailBison email message for that lead from DB where:
       - `channel="email"`
       - `emailBisonReplyId` is not null
       - `emailBisonReplyId` does NOT start with `smartlead:` or `instantly:`
     - Use that message’s `emailBisonReplyId` as the preferred numeric reply id.
   - Compute UUID with `pickEmailBisonReplyUuidForDeepLink({ replies, preferredReplyId })`
   - Build URL: `${resolveEmailBisonBaseUrl(baseHost)}/inbox/replies/${uuid}`
4. Ensure error handling returns `{ success:false, error }` (no thrown errors to the client UI).

## Planned Output
- `actions/emailbison-link-actions.ts` server action returning a ready-to-open EmailBison URL (no secrets leaked).

## Planned Handoff
- Phase 133c calls this server action from the lead drawers and opens the returned URL in a new browser tab.

## Output
- Added `actions/emailbison-link-actions.ts` with `resolveEmailBisonReplyUrlForLead(leadId)` server action.
- Server action enforces lead access, validates EmailBison provider configuration, fetches replies, selects a reply UUID, and returns a final web UI URL using the workspace-specific base host.

## Handoff
- Proceed to Phase 133c to add “Open in EmailBison” buttons in both lead drawers and call the server action from the client.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `resolveEmailBisonReplyUrlForLead()` server action that resolves a safe EmailBison deep-link URL (no secrets in the browser).
  - Ensured SmartLead/Instantly reply handles are excluded when selecting a preferred EmailBison reply id.
- Commands run:
  - `npm run typecheck` — pass
- Blockers:
  - None
- Next concrete steps:
  - Add UI buttons in both lead drawers (Phase 133c).
