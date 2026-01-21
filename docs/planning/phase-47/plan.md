# Phase 47 — Prompt Editor in AI Dashboard

## Purpose

Add the ability to view and edit AI prompts directly from the AI Dashboard in Settings, enabling workspace admins to customize prompt templates without code changes.

## Context

Currently, AI prompts are:
- **Hardcoded** in `lib/ai/prompt-registry.ts` (30+ prompt templates)
- **Viewed** in a read-only modal via "View Prompts" button in Settings → AI Personality → AI Dashboard
- **Not editable** without code deployment

The user requested the ability to edit prompts from the same location where they're currently viewed.

Additional requirement (clarified):
- Many prompts are **composed** from a “master” template plus reusable snippets/variables (ex: “forbidden terms”).
- When showing prompts in the dashboard, we must also surface these smaller pieces (and make them editable), ideally with a nested UX.
- Master variables and all prompt-building components must be editable inside the prompt modal, including:
  - forbidden terms
  - email length instructions (and any related bounds/config)
  - booking process instructions (including the phrasing/templates used to generate them) — **scoped per booking stage**
  - email structure archetype instructions
  - AI persona variables that are injected into draft prompts (tone/greeting/goals/signature/etc.)

**Key Files:**
- `lib/ai/prompt-registry.ts` — Defines all AI prompt templates
- `components/dashboard/settings-view.tsx` — Contains the "Backend Prompts" dialog (currently read-only)
- `actions/ai-observability-actions.ts` — `getAiPromptTemplates()` server action
- `lib/ai-drafts.ts` — Builds draft prompts in code (includes hardcoded forbidden terms list today)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 46 | Complete | `lib/ai-drafts.ts` | Phase 46 improved draft generation; no conflict |
| Phase 45 | Complete | `lib/ai-drafts.ts`, `settings-view.tsx` | Bulk regeneration card added; no conflict with prompt modal |
| Phase 44 | Complete | None | Unrelated (EmailBison/Calendly auth) |

## Repo Reality Check (RED TEAM)

- What exists today:
  - Settings → AI Dashboard has a `View Prompts` button that opens a `Dialog` titled “Backend Prompts” (`components/dashboard/settings-view.tsx`).
  - Prompt templates are listed via `listAIPromptTemplates()` (`lib/ai/prompt-registry.ts`) and fetched by `getAiPromptTemplates(clientId)` (`actions/ai-observability-actions.ts`).
  - Several runtime call sites do **not** use the prompt registry message content (notably draft generation in `lib/ai-drafts.ts`, which builds system prompts and forbidden terms in code).
- Verified touch points:
  - `lib/ai/prompt-registry.ts`: `listAIPromptTemplates()`, `getAIPromptTemplate()`
  - `actions/ai-observability-actions.ts`: `getAiPromptTemplates()`, `requireClientAdminAccess()`
  - `components/dashboard/settings-view.tsx`: `aiPromptsOpen`, `aiPromptTemplates`, `getAiPromptTemplates(activeWorkspace)`
- Multi-agent coordination:
  - Pre-flight: run `git status` and ensure no unexpected local changes in `prisma/schema.prisma`, `components/dashboard/settings-view.tsx`, `lib/ai-drafts.ts`, and `lib/booking-process-instructions.ts` before implementing this phase.
  - If other phases are concurrently touching these files, coordinate/merge first to avoid schema drift and UI conflicts.

## Objectives

* [ ] Create Prisma model for workspace-level prompt overrides
* [ ] Update prompt registry to check for workspace overrides
* [ ] Transform the read-only prompt modal into an editable interface
* [ ] Add server actions for saving/resetting prompt overrides
* [ ] Surface and edit prompt “snippets/variables” used during prompt composition (ex: forbidden terms) with a nested UX
* [ ] Make “master variables” editable inside the prompt modal (AI Persona fields + other prompt-building blocks)
* [ ] Add configurable delay before AI auto-send for AI-managed campaigns
* [ ] Ensure edits actually affect **runtime** prompts (not just what the modal displays)
* [ ] Verify with lint/build

## Constraints

- Prompt overrides are **per-workspace** (multi-tenant safe)
- Default prompts remain in code (overrides are optional)
- Only workspace admins can edit prompts
- Preserve prompt versioning in `AIInteraction.promptKey` for observability
- Avoid breaking existing AI pipeline flows
- No lead PII in the prompt editor UI (preview must be template-only or use sample values)
- Guardrails for prompts that require strict JSON / Structured Outputs (warn + validate required placeholders)

## Success Criteria

- [ ] Workspace admins can view and edit prompt messages in the AI Dashboard modal
- [ ] Workspace admins can view/edit prompt composition snippets (ex: forbidden terms) in a nested UI
- [ ] Workspace admins can edit master variables inside the prompt modal (tone/greeting/goals/signature/company context, etc.)
- [ ] Workspace admins can edit:
  - booking process instruction templates
  - email length instruction templates (and bounds if applicable)
  - email draft structure archetype instructions
- [ ] Workspace admins can choose which AI persona context they are editing/previewing (default persona vs campaign persona)
- [ ] For campaigns in `AI_AUTO_SEND` mode, admins can configure an auto-send delay; auto-sends occur only after the delay elapses (and are cancellable/skippable if the conversation changes — including new inbounds on other channels)
- [ ] Edits persist to database and are used in AI calls for that workspace
- [x] "Reset to Default" button restores original prompt content
- [ ] Changes to prompts are reflected immediately in new AI interactions
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [x] `npm run db:push` completes successfully

## Subphase Index

* a — Prisma schema: `PromptOverride` model
* b — Prompt registry: workspace override lookup
* c — Server actions: CRUD for prompt overrides
* d — UI: editable prompt modal in Settings
* e — Prompt snippets/variables: schema + server actions (for composed prompts like forbidden terms)
* f — UI: nested snippet editor + effective prompt preview
* g — Expand variables: email length rules + archetypes (snippet overrides)
* h — UI: master variables editor inside modal + expanded nested UX
* i — Call-site alignment: ensure runtime uses editable templates/variables
* j — Persona scoping: edit default/campaign personas in modal
* k — Booking stage templates: per-stage booking instruction text overrides
* l — AI auto-send delay: campaign setting + background job scheduling

## Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `PromptOverride` + `PromptSnippetOverride` + `BookingProcessStage.instructionTemplates` + `EmailCampaign` delay fields + new delayed auto-send BackgroundJob type (and any supporting fields) |
| `lib/ai/prompt-registry.ts` | Add workspace override lookup helper(s) (and apply snippet/variable expansion for UI preview) |
| `actions/ai-observability-actions.ts` | Add save/reset server actions |
| `components/dashboard/settings-view.tsx` | Transform modal to support editing |
| `lib/ai-drafts.ts` | Use workspace-configurable forbidden terms/snippets (so UI edits affect runtime) |
| `lib/booking-process-instructions.ts` | Make booking instruction phrasing/template editable via overrides |
| `lib/ai-drafts/config.ts` | Allow overriding email archetype instructions |
| `actions/ai-persona-actions.ts` | Reuse persona CRUD for modal edits (if needed) |
| `actions/booking-process-actions.ts` | Persist per-stage booking instruction templates (admin-gated) |
| `actions/email-campaign-actions.ts` | Persist auto-send delay setting (admin-gated) |
| `components/dashboard/settings/ai-campaign-assignment.tsx` | Add delay editor for AI auto-send campaigns |
| `lib/background-jobs/*` | Schedule delayed auto-send via background jobs (no sleeping in request path) |

## Design Decisions

### Storage Model

```prisma
model PromptOverride {
  id        String   @id @default(uuid())
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  promptKey String   // e.g., "sentiment.classify.v1"
  role      String   // "system", "assistant", or "user"
  index     Int      // Message index within the role group
  baseContentHash String // Hash of the default message content at save-time (prevents index drift)
  content   String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([clientId, promptKey, role, index])
  @@index([clientId])
}
```

### Prompt Composition Snippets (Needed for “forbidden terms”, etc.)

Some templates include placeholders (ex: `{forbiddenTerms}`) or are assembled from multiple “tiny” fragments at runtime. To support an editable nested UX without duplicating content per prompt, add a per-workspace snippet store (see subphase e) and expand it to cover:
- forbidden terms (email drafts)
- email length instruction template (and bounds if overridden)
- booking process instruction templates (per BookingProcessStage)
- email draft archetype instructions

### Override Resolution

1. When generating AI responses, look up overrides by `(clientId, promptKey, role, index)`
2. If override exists, use override content
3. If no override, use default from code
4. Track which version was used in `AIInteraction.promptKey` (append a stable override/snippet version suffix)

### UI Flow

1. User opens "View Prompts" modal (existing button)
2. Modal shows prompts with "Edit" button on each message block and indicators for overrides/snippets
3. Click "Edit" → transforms block into textarea
4. "Save" persists to database as `PromptOverride`
5. "Reset to Default" deletes the override record
6. Visual indicator shows when a prompt has overrides
7. For messages with placeholders/snippets (ex: forbidden terms), show a nested editor for the snippet values and a preview of the effective message content

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Prompt editor changes do not affect runtime prompts for composed prompts (notably drafts) because many call sites build prompts in code rather than consuming registry message content → Mitigation: add snippet store + wire draft generation (and any other composed call sites) to consume it.
- Override addressing via `(role, index)` is brittle if templates change (added/removed messages shift indices) → Mitigation: store a base-content hash on each override and ignore/flag mismatches (prevents index drift).
- “Edit everything” makes it easy to break strict JSON/Structured Output prompts → Mitigation: validate required placeholders, highlight risky prompts, and keep reset-to-default fast and obvious.
- Auto-send delay implemented as `sleep` inside webhook/background processing would cause timeouts and unreliable behavior → Mitigation: use the existing background job scheduler (`runAt`) and cron runner.

### Repo mismatches (fix the plan during implementation)
- `components/dashboard/settings-view.tsx` passes `activeWorkspace` as a string clientId (not `activeWorkspace.id`).
- Some planned “prompt registry update” steps must account for call sites that use registry only for metadata (featureId/promptKey) but not for message text (`lib/ai-drafts.ts`).

### Observability/versioning
- If prompts become editable, `AIInteraction.promptKey` must distinguish default vs overridden content; otherwise analytics cannot attribute changes → Mitigation: append a short, stable “override version” suffix derived from the newest override/snippet `updatedAt` or a content hash.

### Security/permissions
- Ensure all save/reset actions are admin-gated (`requireClientAdminAccess`) and server-only.

### Validation/testing
- Add manual smoke checks for: edited prompt used in a live AI call path, reset restores behavior, and UI does not leak lead data.

## Decisions (Locked)

- Master variables are editable inside the prompt modal.
- Master variables for draft prompts map to **AI Persona settings** (default persona and campaign-assigned persona).
- Booking process instructions are editable **per booking stage** (real runtime behavior, not preview-only).
- Email length instructions, forbidden terms, and archetype instructions are editable as well.
- AI-managed campaigns (responseMode `AI_AUTO_SEND`) support a configurable **auto-send delay window** after inbound reply receipt:
  - UI shows minutes (min/max)
  - DB stores seconds (min/max)
  - scheduling picks a randomized second within the configured window
  - default ships as `3–7 minutes` unless overridden
  - max clamp is `60 minutes` (`0..3600` seconds)
- Everything in the prompt editor is workspace-scoped and admin-gated.
- Across automation workflows (drafting + auto-send), the system prioritizes the **newest inbound messages across all channels**:
  - For each channel, find that channel’s latest outbound message timestamp.
  - Collect **all inbound messages after that outbound** (per channel; supports “double” email/text).
  - Union them across channels as “latest inbound(s)”.
  - Define the “active trigger inbound” as the newest inbound message (max `sentAt`) within that union; only this trigger should drive draft/eval/send (older triggers skip).
  - The response channel is still the channel currently being processed/sent on, but prompts must include cross-channel “latest inbound(s)” context (current channel prioritized).

## Open Questions (Need Human Input)

- None (locked by user clarification).

## Assumptions (Agent)

- Prompt message overrides (`PromptOverride`) are stored per-workspace (`Client`) only (confidence ~95%).
- Booking instruction template overrides are stored per booking stage (`BookingProcessStage.instructionTemplates`) and remain within the owning workspace via the booking process relation (confidence ~90%).
- Auto-send delay window is stored per campaign (`EmailCampaign.autoSendDelayMinSeconds` + `EmailCampaign.autoSendDelayMaxSeconds`) (confidence ~90%).
- A preview can use sample values for lead-specific placeholders to avoid PII leakage (confidence ~90%).

## Verification Plan

1. Create a test override for `sentiment.classify.v1` system prompt
2. Trigger sentiment classification via webhook/UI
3. Verify the override content is used in the AI call
4. Reset to default and verify original content is restored
5. Run lint/build checks

## Phase Summary

- Shipped:
  - Prompt override persistence + drift detection (`prisma/schema.prisma`, `lib/ai/prompt-registry.ts`, `actions/ai-observability-actions.ts`)
  - Prompt editor modal (message overrides + snippet variables) (`components/dashboard/settings-view.tsx`)
  - Snippet defaults + runtime consumption for email forbidden terms/length/archetypes (`lib/ai/prompt-snippets.ts`, `lib/ai-drafts.ts`)
  - Auto-send delay (minutes UI / seconds DB, background job scheduling + cancellation) (`components/dashboard/settings/ai-campaign-assignment.tsx`, `actions/email-campaign-actions.ts`, `lib/background-jobs/*`)
  - Booking stage templates backend/runtime support (`prisma/schema.prisma`, `lib/booking-stage-templates.ts`, `lib/booking-process-instructions.ts`, `actions/booking-process-actions.ts`)
- Verified:
  - `npm run lint`: pass (2026-01-21 16:22 +03)
  - `npm run build`: pass (2026-01-21 16:22 +03)
  - `npm run db:push`: pass / already in sync (2026-01-21 16:23 +03)
- Notes:
  - See `docs/planning/phase-47/review.md` for critical gaps (workspace prompt cache leak; booking stage templates persistence; snippet registry incompleteness; draft prompt/runtime misalignment).
