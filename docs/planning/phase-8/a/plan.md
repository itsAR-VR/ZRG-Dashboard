# Phase 8a — Audit Current GHL Contact Creation/Linking Flows

## Focus
Confirm and document how/when the system creates or links a GHL contact today—especially for EmailBison “Interested” signals—so always-on sync/backfill behavior aligns with existing production behavior.

## Inputs
- Email webhook: `app/api/webhooks/email/route.ts` (notably `handleLeadInterested` and positive-sentiment paths)
- GHL resolver: `lib/ghl-contacts.ts` (`ensureGhlContactIdForLead`)
- Sync paths: `actions/message-actions.ts` (`smartSyncConversation`, `syncAllConversations`)
- SMS webhook: `app/api/webhooks/ghl/sms/route.ts`

## Work
1. Identify every code path that calls `ensureGhlContactIdForLead` (email webhook, manual sync, booking preflight, etc).
2. Confirm the intended semantics for “ensure” in production:
   - When it should only search/link vs when it may create/upsert a contact.
   - Whether “allowCreateWithoutPhone” is required in email-first flows.
3. Document where GHL contact fields are expected to be the source-of-truth for hydration (phone/name/company) vs EmailBison custom variables vs Clay.
4. Define “always-on sync/backfill” semantics precisely:
   - Which leads are eligible for GHL lookup/hydration (e.g., missing phone/email/name/company; missing `ghlContactId` but has email).
   - Default stance: **search/link/hydrate only** (no contact creation for everyone).
   - Explicit exception: EmailBison positive/“Interested” workflow continues to create/link as it does today.
   - Decide if any additional classes (e.g., manually-approved sends) should be allowed to create/upsert, and document the gate.

## Output
- A short, explicit map of current creation/linking behavior and a decision on what “always-on” backfill does (search/link only vs allow-create).

## Handoff
Proceed to implement always-on resolve/hydrate behavior in Phase 8b using the decided semantics.

### Findings (Current Creation/Linking Map)
- Email webhook (positive + Interested):
  - Positive reply path ensures/link/creates contact: `app/api/webhooks/email/route.ts:1301` (`allowCreateWithoutPhone: true`)
  - `LEAD_INTERESTED` (existing lead): `app/api/webhooks/email/route.ts:1452` (`allowCreateWithoutPhone: true`)
  - `LEAD_INTERESTED` (new lead / positive): `app/api/webhooks/email/route.ts:1573` (`allowCreateWithoutPhone: true`)
- Manual/operational flows:
  - Manual sync tries to resolve missing contactId: `actions/message-actions.ts:311` (currently calls `ensureGhlContactIdForLead()` with default behavior)
  - Sending an SMS ensures contactId and requires phone: `actions/message-actions.ts:819` (`requirePhone: true`)
  - Booking preflight ensures contact: `lib/booking.ts:142` and `actions/booking-actions.ts:370` (`allowCreateWithoutPhone: true`)
  - Clay phone enrichment callback ensures contact + syncs phone: `app/api/webhooks/clay/route.ts:231` (`allowCreateWithoutPhone: true`)
  - LinkedIn webhook (when phone is found) ensures contact + syncs phone: `app/api/webhooks/linkedin/route.ts:238` (`allowCreateWithoutPhone: true`)

### Data Sources (Hydration/Enrichment)
- GHL contact record: canonical for `phone` and often name/company, and needed to keep SMS channel functional.
- EmailBison custom variables: primary for email-first enrichment (phone/linkedin), plus signature extraction and Clay fallbacks.
- SMS webhook payloads: may omit phone/email; must hydrate from GHL contact to avoid “SMS unavailable” in dashboard.

### Policy Decision (For Phase 8b/8c)
- **Sync (single + all) and global backfill must be search/link/hydrate only**:
  - Resolve `ghlContactId` by searching GHL via email (and optionally phone) and link if found.
  - Do **not** create/upsert contacts as part of sync/backfill unless a specific workflow explicitly opts in.
- **Creation remains explicitly allowed** for existing production workflows that already do it:
  - EmailBison positive/Interested signals (`allowCreateWithoutPhone: true`)
  - Booking flows (`allowCreateWithoutPhone: true`)
  - Phone enrichment callbacks (Clay/LinkedIn) that sync phone into GHL after discovery
  - Explicit send-SMS path (`requirePhone: true`) if/when creation is necessary

### Implementation Note (To Address in 8b)
- `ensureGhlContactIdForLead` currently performs a best-effort `upsert` even after finding an existing contact; this can risk duplicates in some location configurations. In Phase 8b we should prefer `PUT /contacts/{id}` (update-by-id) when a contact is already known.
