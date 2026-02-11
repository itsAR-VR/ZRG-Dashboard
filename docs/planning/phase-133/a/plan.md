# Phase 133a — Deep-Link Contract + Helpers

## Focus
Lock the EmailBison deep-link contract and implement the minimal pure helpers needed so the server action can reliably choose a reply UUID and build the correct base origin for white-label workspaces.

## Inputs
- User-provided UI URL pattern: `https://<base-origin>/inbox/replies/<reply_uuid>`
- Existing base-host support in `lib/emailbison-api.ts` (`Client.emailBisonBaseHost.host` + `EMAILBISON_BASE_URL` fallback)
- Existing reply payload shape includes `uuid` in `EmailBisonReplyMessage`

## Work
1. Export `resolveEmailBisonBaseUrl(baseHost?: string | null): string` from `lib/emailbison-api.ts` (no behavioral change; just export).
2. Create a pure helper to select the best EmailBison reply UUID for deep-linking:
   - New file: `lib/emailbison-deeplink.ts`
   - Function: `pickEmailBisonReplyUuidForDeepLink(params)`
     - Inputs: array of `EmailBisonReplyMessage` and an optional preferred numeric reply id (string)
     - Rule 1: if preferred reply id matches a reply with a `uuid`, return that `uuid`
     - Rule 2: otherwise, choose the most recent reply that has a `uuid` (sort by `date_received ?? created_at ?? updated_at`, descending)
     - Return `null` if none have a UUID
3. Document in code comments (briefly) that EmailBison deep links use `uuid`, not numeric `id`.

## Planned Output
- `lib/emailbison-api.ts` exports `resolveEmailBisonBaseUrl`
- `lib/emailbison-deeplink.ts` provides deterministic UUID selection logic

## Planned Handoff
- Phase 133b uses these helpers to build the server action that resolves a deep-link URL without exposing credentials to the client.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Exported `resolveEmailBisonBaseUrl()` for reuse by UI deep-link builders.
  - Added `pickEmailBisonReplyUuidForDeepLink()` helper to select an EmailBison reply `uuid` (preferred numeric reply id match first, then newest UUID).
- Commands run:
  - `nl -ba lib/emailbison-api.ts | sed -n '140,210p'` — pass
- Blockers:
  - None
- Next concrete steps:
  - Implement server action to resolve an EmailBison deep link URL for a lead (`actions/emailbison-link-actions.ts`).

## Output
- Updated `lib/emailbison-api.ts` to export `resolveEmailBisonBaseUrl()`.
- Added `lib/emailbison-deeplink.ts` with `pickEmailBisonReplyUuidForDeepLink()`.

## Handoff
- Proceed to Phase 133b to implement the server action that resolves the final URL and keeps EmailBison API keys server-only.
