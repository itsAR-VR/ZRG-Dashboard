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
  - Working tree currently has many uncommitted changes touching `components/dashboard/settings-view.tsx`, `lib/ai-drafts.ts`, and `prisma/schema.prisma`.
  - Implementation should be done on a clean/merged base to avoid schema drift and UI conflicts.

## Objectives

* [ ] Create Prisma model for workspace-level prompt overrides
* [ ] Update prompt registry to check for workspace overrides
* [ ] Transform the read-only prompt modal into an editable interface
* [ ] Add server actions for saving/resetting prompt overrides
* [ ] Surface and edit prompt “snippets/variables” used during prompt composition (ex: forbidden terms) with a nested UX
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
- [ ] Edits persist to database and are used in AI calls for that workspace
- [ ] "Reset to Default" button restores original prompt content
- [ ] Changes to prompts are reflected immediately in new AI interactions
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm run db:push` completes successfully

## Subphase Index

* a — Prisma schema: `PromptOverride` model
* b — Prompt registry: workspace override lookup
* c — Server actions: CRUD for prompt overrides
* d — UI: editable prompt modal in Settings
* e — Prompt snippets/variables: schema + server actions (for composed prompts like forbidden terms)
* f — UI: nested snippet editor + effective prompt preview

## Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `PromptOverride` model |
| `lib/ai/prompt-registry.ts` | Add workspace override lookup helper(s) (and apply snippet/variable expansion for UI preview) |
| `actions/ai-observability-actions.ts` | Add save/reset server actions |
| `components/dashboard/settings-view.tsx` | Transform modal to support editing |
| `lib/ai-drafts.ts` | Use workspace-configurable forbidden terms/snippets (so UI edits affect runtime) |

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
  content   String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([clientId, promptKey, role, index])
  @@index([clientId])
}
```

### Prompt Composition Snippets (Needed for “forbidden terms”, etc.)

Some templates include placeholders (ex: `{forbiddenTerms}`) or are assembled from multiple “tiny” fragments at runtime. To support an editable nested UX without duplicating content per prompt, add a per-workspace snippet store (see subphase e).

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
- Override addressing via `(role, index)` is brittle if templates change (added/removed messages shift indices) → Mitigation: add stable message IDs or store a default-content hash alongside overrides and ignore/flag mismatches.

### Repo mismatches (fix the plan during implementation)
- `components/dashboard/settings-view.tsx` passes `activeWorkspace` as a string clientId (not `activeWorkspace.id`).
- Some planned “prompt registry update” steps must account for call sites that use registry only for metadata (featureId/promptKey) but not for message text (`lib/ai-drafts.ts`).

### Observability/versioning
- If prompts become editable, `AIInteraction.promptKey` must distinguish default vs overridden content; otherwise analytics cannot attribute changes → Mitigation: append a short, stable “override version” suffix derived from the newest override/snippet `updatedAt` or a content hash.

### Security/permissions
- Ensure all save/reset actions are admin-gated (`requireClientAdminAccess`) and server-only.

### Validation/testing
- Add manual smoke checks for: edited prompt used in a live AI call path, reset restores behavior, and UI does not leak lead data.

## Open Questions (Need Human Input)

- [ ] Should the prompt editor allow editing workspace “master” variables (tone/greeting/goals/etc.) directly inside the prompt modal, or only show them read-only with a link to the existing AI Personality form? (confidence ~70%)
  - Why it matters: changes scope/UI complexity (nested variable editor vs just snippet + message editing).
  - Current assumption in this plan: editable snippets (ex: forbidden terms) inside modal; master AI Persona fields remain edited in the existing settings form.
- [ ] Which prompts must be fully editable vs read-only due to structured-output requirements (JSON schema) and safety concerns? (confidence ~65%)
  - Why it matters: determines guardrails/validation and whether we block editing for some prompts.
  - Current assumption in this plan: allow editing but warn + validate required placeholders for schema-critical prompts.

## Assumptions (Agent)

- Prompt overrides and snippet overrides are stored per-workspace (`Client`) only (confidence ~95%).
- A preview can use sample values for lead-specific placeholders to avoid PII leakage (confidence ~90%).

## Verification Plan

1. Create a test override for `sentiment.classify.v1` system prompt
2. Trigger sentiment classification via webhook/UI
3. Verify the override content is used in the AI call
4. Reset to default and verify original content is restored
5. Run lint/build checks
