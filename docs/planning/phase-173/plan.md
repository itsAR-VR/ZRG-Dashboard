# Phase 173 — CRM External Sync Webhook + CRM Scrollability Hardening

## Purpose
Deliver two CRM upgrades from this conversation: make CRM views reliably scrollable, and add outbound webhook sync so new/updated leads can be pushed to an external CRM using the same analytics CRM logic.

## Context
- Product asks covered in this phase:
  - "Whenever a lead comes in, send it to an external CRM webhook."
  - "Make CRM scrollable as well."
- Confirmed design decisions from planning:
  - Trigger scope: on lead CRM-row creation/update and analytics CRM-row edits.
  - Payload scope: full CRM row mapping.
  - Auth/signing: HMAC with shared secret header.
  - Delivery model: async best-effort with retry + dedupe.
  - Config surface: workspace settings UI (with server-side secret handling).
- Existing repo capabilities we will build on:
  - CRM row mapping and edit paths in `actions/analytics-actions.ts`.
  - Lead interest upsert path in `lib/lead-crm-row.ts` and inbound post-process pipelines.
  - Durable webhook queue orchestration in `lib/webhook-events/runner.ts`.
  - Existing idempotent destination logging pattern in `NotificationSendLog`.

## Directive Lock (User)
- NTTAN validation is explicitly waived for this phase by user direction (`2026-02-19`).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 170 | Active | `actions/analytics-actions.ts`, admin/settings surfaces | Re-read shared files before edits and merge semantically (do not overwrite analytics/auth hardening). |
| Phase 171 | Active | webhook/queue runtime conventions | Keep CRM outbound queue additive to existing webhook-event processing semantics. |
| Phase 172 | Active | `actions/settings-actions.ts`, `prisma/schema.prisma` | Merge settings/schema changes semantically; do not regress quota/runtime hardening. |
| Phase 169 | Active | webhook/cron operational patterns | Reuse existing async dispatch + dedupe + observability conventions. |

## Objectives
* [x] Make `CRM / Leads` and `Analytics > CRM` reliably scrollable (vertical + horizontal overflow).
* [x] Add workspace-configurable outbound CRM webhook integration with secure secret handling.
* [x] Reuse analytics CRM row logic to build outbound payloads (single source of truth behavior).
* [x] Emit webhook events on lead interest upsert and CRM sheet-relevant edits.
* [x] Process outbound webhooks asynchronously with retries, dedupe, and delivery telemetry.

## Constraints
- Do not alter CRM business logic semantics while fixing scroll behavior.
- Preserve existing auth/capability checks in settings and admin routes.
- Never expose webhook secrets in client-facing payloads/responses/logs.
- Outbound delivery must be async; no blocking synchronous webhook send on critical request paths.
- Idempotency/dedupe must be explicit to prevent duplicate external CRM writes.
- Enforce outbound URL safety: HTTPS-only and reject localhost/private-network targets.
- If `prisma/schema.prisma` changes, run `npm run db:push` before closeout.

## Success Criteria
- CRM scroll UX:
  - `components/dashboard/crm-view.tsx` supports stable vertical list scrolling and horizontal overflow for table-width constraints.
  - `components/dashboard/analytics-view.tsx` + `components/dashboard/analytics-crm-table.tsx` preserve CRM tab scroll behavior without clipping.
- Webhook config + payload:
  - Workspace settings can store webhook enable/url/events/secret with capability gating and masked read behavior.
  - Outbound payload includes full CRM row fields consistent with analytics CRM mapping behavior.
- Triggering + delivery:
  - New interest/upsert events and CRM row edit events enqueue outbound webhook work.
  - Worker sends signed payload with HMAC headers, retries transient failures, and dedupes repeated events via durable queue keys.
  - Delivery outcomes are queryable via logs/records for support triage.
- Validation gates:
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - If schema changed: `npm run db:push`

## Repo Reality Check (RED TEAM)
- What exists today:
  - `BackgroundJob` requires `clientId`, `leadId`, and `messageId`, which does not fit CRM edit events that are not message-centric.
  - `WebhookEvent` already supports durable queueing, retries, dedupe keys, and stale lock recovery in `lib/webhook-events/runner.ts`.
  - `WorkspaceSettings` currently has no outbound CRM webhook fields in `prisma/schema.prisma`.
  - CRM row mapping/edit surfaces are available in `actions/analytics-actions.ts` and `lib/lead-crm-row.ts`.
- Verified touch points:
  - `actions/analytics-actions.ts` (`getCrmSheetRows`, `updateCrmSheetCell`)
  - `lib/lead-crm-row.ts` (`upsertLeadCrmRowOnInterest`)
  - `actions/settings-actions.ts`
  - `app/api/admin/workspaces/route.ts`
  - `lib/webhook-events/runner.ts`
  - `prisma/schema.prisma`

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
- Modeling CRM outbound sends as `BackgroundJob` would force `messageId` coupling and break CRM-edit trigger coverage.
  - Mitigation: route CRM outbound via `WebhookEvent` queue with dedicated provider/event handler.
- Workspace webhook URL could be abused for SSRF/exfiltration if unrestricted.
  - Mitigation: enforce HTTPS + private-network/localhost deny at settings write-time.

### Missing or ambiguous requirements
- Secret handling was not explicit for reads vs writes.
  - Mitigation: secret is write-only on mutation, never returned unmasked from `getUserSettings`.
- Replay diagnostics were not required in evidence output.
  - Mitigation: record command outputs, queue retry/dedupe evidence, and delivery logs in closeout artifacts.

### Multi-agent coordination gaps
- Overlap risk on `actions/settings-actions.ts` and `prisma/schema.prisma` with nearby active phases.
  - Mitigation: re-read shared files immediately before edits and document merge/coordination notes in subphase Output.

## Assumptions (Agent)
- Reusing `WebhookEvent` queue is lower-risk than widening `BackgroundJob` relation requirements for this phase (confidence ~95%).
- Existing URL-safety helpers (private network/hostname checks) can be reused for webhook endpoint validation (confidence ~92%).

## Subphase Index
* a — CRM Scrollability Hardening (`CRM / Leads` + `Analytics > CRM`)
* b — Webhook Config Surface + Payload Contract (Workspace Settings Driven)
* c — Event Trigger Wiring (Lead Interest + CRM Edit Paths)
* d — Async Delivery Worker (WebhookEvent Queue, HMAC, Retry, Dedupe, Observability)
* e — Validation, Rollout, and Operational Closeout
* f — Queue Contract + Egress Guardrail Hardening and Final RED TEAM Pass

## Residual Manual Checks
- Live external CRM endpoint smoke verification (signed payload receipt + forced transient failure retry path) must be performed in runtime environment with a configured workspace webhook URL/secret.

## Phase Summary (running)
- 2026-02-19 20:20:36Z — Implemented CRM scrollability hardening across CRM/Analytics views with flex/overflow chain fixes (`components/dashboard/crm-view.tsx`, `components/dashboard/analytics-view.tsx`, `components/dashboard/analytics-crm-table.tsx`).
- 2026-02-19 20:20:36Z — Added workspace CRM webhook settings contract and secure normalization/masking (`prisma/schema.prisma`, `actions/settings-actions.ts`, `app/api/admin/workspaces/route.ts`, `lib/crm-webhook-config.ts`).
- 2026-02-19 20:20:36Z — Wired CRM webhook event enqueue + payload contract reuse + async outbound processor on `WebhookEvent` queue (`actions/analytics-actions.ts`, `lib/lead-crm-row.ts`, `lib/crm-webhook-events.ts`, `lib/crm-webhook-payload.ts`, `lib/webhook-events/runner.ts`, `lib/webhook-events/crm-outbound.ts`, `lib/webhook-events/errors.ts`).
- 2026-02-19 20:20:36Z — Validation completed: `npm run lint` (pass with warnings), `npm run build` (pass), `npm test` (pass 417/417), `npm run db:push` (pass).
