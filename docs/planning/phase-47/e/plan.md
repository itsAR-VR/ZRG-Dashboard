# Phase 47e — Prompt Snippets/Variables: Schema + Server Actions

## Focus

Support prompt composition where a “master” prompt references smaller reusable pieces (snippets/variables), starting with email draft **forbidden terms**, and make those pieces editable per workspace.

## Inputs

- Phase 47a: `PromptOverride` table (message-level overrides)
- `lib/ai/prompt-registry.ts` templates that include placeholders (ex: `{forbiddenTerms}`)
- Runtime prompt composition that currently lives outside the registry (notably `lib/ai-drafts.ts` forbidden terms list)
- Admin gating helper: `requireClientAdminAccess()` (`lib/workspace-access.ts` via actions)

## Work

1. **Add snippet storage model to `prisma/schema.prisma` (append-only, additive):**

```prisma
model PromptSnippetOverride {
  id        String   @id @default(uuid())
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  snippetKey String  // e.g. "forbiddenTerms" (email draft forbidden terms)
  content   String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([clientId, snippetKey])
  @@index([clientId])
}
```

2. **Define canonical snippet defaults in code (single source of truth):**
   - Create a server-only helper (new file) to:
     - provide default snippet values (ex: migrate `EMAIL_FORBIDDEN_TERMS` default list)
     - format snippet values for different insertion styles (comma list vs newline list)

3. **Add admin-gated server actions for snippet CRUD:**
   - Location: `actions/ai-observability-actions.ts` (or a new `actions/ai-prompt-actions.ts` if it grows too large)
   - Actions:
     - `getPromptSnippetOverrides(clientId)` → list `{ snippetKey, content }`
     - `savePromptSnippetOverride(clientId, { snippetKey, content })` → upsert
     - `resetPromptSnippetOverride(clientId, snippetKey)` → delete

4. **Wire runtime prompt composition to use snippet overrides (MVP: forbidden terms):**
   - Update `lib/ai-drafts.ts`:
     - replace the hardcoded `EMAIL_FORBIDDEN_TERMS` usage with:
       - `effectiveForbiddenTerms = override ?? default`
       - use the same effective value in:
         - Step 2 (Generation) instructions
         - fallback single-step assistant message block
   - Ensure behavior remains identical when no override exists.

5. **Prompt versioning for observability (minimum viable):**
   - Define an “override version” string derived from the newest `updatedAt` across:
     - `PromptOverride` rows for that promptKey
     - snippet override rows used by that prompt (ex: `forbiddenTerms`)
   - Append to `AIInteraction.promptKey` as a suffix when overrides/snippets are applied (example: `draft.generate.email.generation.v1.ovr_2026-01-21T08:00Z`).
   - Avoid embedding content in telemetry keys.

## Validation (RED TEAM)

- `npm run db:push` completes (schema is additive; no data loss).
- Saving a snippet override requires workspace admin; non-admin returns `{ success: false }`.
- Draft generation behavior is unchanged when no overrides exist (compare prompts before/after for default workspace).

## Output

**Completed:**

1. **Schema** (`prisma/schema.prisma`):
   - Added `PromptSnippetOverride` model with `clientId`, `snippetKey`, `content`
   - Added relation to `Client`: `promptSnippetOverrides PromptSnippetOverride[]`
   - `npm run db:push` succeeded

2. **Snippet Defaults Helper** (`lib/ai/prompt-snippets.ts`):
   - Exported `DEFAULT_FORBIDDEN_TERMS` — canonical list of ~70 terms
   - Exported `SNIPPET_DEFAULTS` registry: `{ forbiddenTerms: string }`
   - Functions: `getSnippetDefault()`, `listSnippetKeys()`
   - Formatting: `formatSnippetAsCommaSeparated()`, `formatSnippetAsNewlineSeparated()`
   - Lookup: `getEffectiveSnippet()`, `getEffectiveForbiddenTerms()`, `getSnippetOverridesForWorkspace()`

3. **Server Actions** (`actions/ai-observability-actions.ts`):
   - `getPromptSnippetOverrides(clientId)` — fetch all snippet overrides
   - `savePromptSnippetOverride(clientId, snippetKey, content)` — upsert
   - `resetPromptSnippetOverride(clientId, snippetKey)` — delete

4. **Runtime Integration** (`lib/ai-drafts.ts`):
   - Replaced hardcoded `EMAIL_FORBIDDEN_TERMS` with `DEFAULT_FORBIDDEN_TERMS` import
   - Added `effectiveForbiddenTerms` fetch at start of email draft pipeline
   - Updated `buildEmailDraftGenerationInstructions()` to accept `forbiddenTerms` param
   - Updated fallback single-step path to use `effectiveForbiddenTerms`

**Note:** Telemetry promptKey versioning for snippet overrides deferred to 47i (call-site alignment).

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed

## Handoff

Phase 47f updates the Settings → AI Dashboard prompt editor UI to:
- Display snippet values nested under template messages
- Allow editing/resetting snippets (starting with forbidden terms)
- Show snippet key labels and current values

