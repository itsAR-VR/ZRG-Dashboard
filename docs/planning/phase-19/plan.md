# Phase 19 — SmartLead + Instantly Email Integration (EmailBison Parity + Single-Select)

## Purpose
Add SmartLead and Instantly as first-class email providers, with EmailBison-parity behavior and strict per-workspace single-select (only one of EmailBison, SmartLead, or Instantly).

## Context
- ZRG currently supports Inboxxia/EmailBison for email ingestion + replies.
- We need SmartLead and Instantly to be usable “in place of EmailBison” when selected.
- Workspaces must remain safe: existing EmailBison workspaces should continue to function, and provider changes must not accidentally wipe credentials unless explicitly updated.
- Note: `docs/planning/` currently has `phase-20/` but no `phase-19/`; this phase intentionally fills that numbering gap.

## Objectives
* [ ] Enforce email provider exclusivity per workspace (server-side + UI)
* [ ] Add SmartLead + Instantly campaign sync (EmailCampaign upserts)
* [ ] Add SmartLead + Instantly inbound/outbound webhook ingestion (creates Message rows + runs AI pipeline)
* [ ] Route outbound email replies through the selected provider
* [ ] Update admin provisioning + Settings UI + README docs
* [ ] Run lint/build and push to GitHub

## Constraints
- Single-select: a workspace cannot have multiple email providers configured at once.
- Never leak secrets to the client/UI; only show “has credential” booleans.
- Webhooks are untrusted input: validate secret before reading/parsing body where possible and dedupe events.
- Prefer reusing existing models/fields (no Prisma schema changes) unless absolutely required.

## Success Criteria
- [x] Existing EmailBison workspaces continue to ingest email webhooks and send replies without requiring changes.
- [x] A workspace can select exactly one provider (EmailBison/SmartLead/Instantly); server rejects ambiguous configurations.
- [x] SmartLead and Instantly inbound replies create `Message(channel="email", direction="inbound")` and trigger sentiment + draft generation.
- [x] SmartLead and Instantly “email sent” events create `Message(channel="email", direction="outbound")` and kick off no-response follow-ups.
- [x] Replies from the UI (manual + AI-approved) send through the selected provider.
- [x] `npm run lint` and `npm run build` pass.
- [x] Branch is pushed to GitHub.

## Subphase Index
* a — Provider selection + workspace safety
* b — Outbound replies + campaign sync parity
* c — SmartLead webhooks (ingestion + dedupe)
* d — Instantly webhooks (ingestion + dedupe)
* e — Settings UI + README updates
* f — QA + GitHub push

---

## Phase Summary
- Added email provider resolution + single-select enforcement:
  - `lib/email-integration.ts`
  - `actions/client-actions.ts`
  - `app/api/admin/workspaces/route.ts`
- Added SmartLead + Instantly provider support:
  - API clients: `lib/smartlead-api.ts`, `lib/instantly-api.ts`
  - Reply handle encoding: `lib/email-reply-handle.ts` (stored in `Message.emailBisonReplyId`)
  - Webhooks: `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/instantly/route.ts`
- Updated UI + docs:
  - `components/dashboard/settings/integrations-manager.tsx`
  - `README.md`
- Pushed branch: `feat/email-providers-smartlead-instantly`
