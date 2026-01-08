# Phase 4b — Backfill: GHL Contact “Custom Variables” → `SmsCampaign`

## Focus
Repair historical unattributed SMS leads by fetching their GHL contact record and extracting the correct SMS sub-client label from contact-level “custom variables” (custom fields/values), then setting `Lead.smsCampaignId`.

## Inputs
- Target workspaces (Client rows): Owen + Uday 18th
- Leads selection:
  - `Lead.ghlContactId != null`
  - `Lead.smsCampaignId == null`
  - `Lead.clientId in {owen, uday18th}`
- GHL API access:
  - `Client.ghlPrivateKey` per workspace
- Existing script reference:
  - `scripts/backfill-sms-campaign.ts` (tags-based backfill)

## Work
1. **Confirm contact response shape**
   - Fetch 1–3 representative contacts from each workspace using `GET /contacts/{contactId}`.
   - Identify where “custom variables” appear (common shapes: `customFields`, `customField`, `customValues`, `customFieldValues`, etc.).
   - Identify the relevant field key(s) that correspond to the sub-client label.

2. **Implement backfill script**
   - Add a script (new or extending the existing one) with:
     - `--dry-run` default; `--apply` to write
     - `--clientId` / `--clientIds` scoping
     - `--limit`, `--offset` (or cursor), and conservative concurrency
   - For each lead:
     - Fetch contact
     - Extract candidate label(s)
     - Normalize via `normalizeSmsCampaignLabel()`
     - Upsert `SmsCampaign` within that workspace
     - Update `Lead.smsCampaignId` (only if still null)

3. **Fallbacks (only if required)**
   - If custom variables are absent/unreliable, optionally fall back to:
     - contact tags (existing logic), and/or
     - webhook-style payload fields if stored elsewhere
   - Keep fallback behavior explicit via flags (e.g., `--allow-tags-fallback`).

4. **Safety + observability**
   - Rate-limit requests and retry GETs on 429/5xx.
   - Print a per-run summary:
     - scanned / updated / skipped (already attributed) / failed / still-unattributed
     - newly created `SmsCampaign` count (deduped)
   - Log only IDs + chosen label (avoid phone/email).

## Output
- A deterministic, repeatable backfill that assigns `smsCampaignId` for historical unattributed leads in Owen + Uday 18th.

## Handoff
Run Phase 4c verification (counts + spot checks) on a dry-run first, then apply, then re-check dashboard filters.
