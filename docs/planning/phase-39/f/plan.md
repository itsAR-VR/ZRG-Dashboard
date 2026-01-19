# Phase 39f — Hardening & Backward Compatibility

## Focus

Close the remaining “failure modes” and compatibility questions for multi-persona support:

- enforce “exactly one default persona” at runtime (transaction-safe)
- decide and implement how legacy `WorkspaceSettings` persona fields behave (sync vs drift)
- ensure lead scoring + other legacy readers remain predictable
- avoid accidental write-on-load behavior in UI and webhook paths

## Inputs

- Root plan: `docs/planning/phase-39/plan.md` (Open Questions + RED TEAM findings)
- Legacy fields:
  - `prisma/schema.prisma` → `WorkspaceSettings.aiPersonaName/aiTone/aiGreeting/aiSmsGreeting/aiSignature/aiGoals/serviceDescription/idealCustomerProfile`
  - `lib/ai-drafts.ts` currently reads `WorkspaceSettings` directly (will change in 39e)
- Lead scoring:
  - `lib/lead-scoring.ts` (uses `WorkspaceSettings.idealCustomerProfile` today)
- Action patterns:
  - `{ success, data?, error? }` return shape
  - `requireClientAdminAccess` and workspace scope checks (`lib/workspace-access`)

## Work

### 1) Default persona correctness (transaction-safe)

- Ensure “set default” is atomic:
  - `updateMany` to unset existing defaults for the client
  - `update` the chosen persona to `isDefault: true`
  - execute both steps in a single Prisma transaction
- Ensure “create persona as default” and “update persona to default” reuse the same transaction pattern.
- Decide behavior when deleting the default persona:
  - if another persona exists → promote one deterministically (oldest or name asc)
  - if none remain → allow no default (drafts fall back to `WorkspaceSettings`)

### 2) Legacy settings sync policy (answer root Open Question)

Pick one and implement consistently:

**Option A (recommended for compatibility): sync default persona → `WorkspaceSettings`**
- When the default persona is created/updated/changed:
  - mirror persona fields into `WorkspaceSettings` legacy fields
  - do not mirror non-default personas
- Outcome: legacy readers (and lead scoring, if unchanged) behave as “default persona”.

**Option B: no sync (drift allowed, but explicit)**
- Leave `WorkspaceSettings` untouched once personas exist.
- UI must clearly warn that legacy settings remain only as fallback.

### 3) Lead scoring consistency

- If Option A: keep lead scoring as-is (reads settings) and it effectively follows default persona ICP due to mirroring.
- If Option B: decide whether to:
  - keep lead scoring on `WorkspaceSettings` and keep ICP editing in settings UI, or
  - update lead scoring to use default persona ICP when personas exist (bigger behavioral change; document as explicit scope increase if chosen).

### 4) Avoid write-on-load / webhook writes

- Persona listing endpoints should be read-only by default.
- “Create Default Persona from current settings” should be an explicit user action (button), not a side-effect of loading the settings page.
- `lib/ai-drafts.ts` (webhook/cron paths) should not create personas; it should only resolve and fall back.

### 5) Observability (optional but high-leverage)

- Decide whether to record persona selection context on draft generation:
  - e.g., append a short suffix to `promptKey`, or
  - include a structured debug log line with `{ personaSource, personaId?, campaignId? }` (no PII)

## Validation (RED TEAM)

- Rapid “Set Default” clicks on two personas → verify exactly one default at the end (server-side).
- Delete the default persona:
  - with other personas present → exactly one new default exists
  - with no other personas → drafts still work via settings fallback
- Ensure “list personas” does not create/write records implicitly.
- Run `npm run lint` and `npm run build`.

## Output

- A documented and implemented compatibility policy (sync vs drift)
- Transaction-safe default persona behavior (no multi-default states)
- Clear UX behavior for no-persona workspaces (explicit create/import action)

## Handoff

Phase 39 can be considered complete after:

- 39a–39e deliver the core feature, and
- 39f decisions are applied so legacy behavior is predictable and safe.

