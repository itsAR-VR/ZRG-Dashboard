# Phase 129b — Runtime Resolution (Workspace > System > Code)

## Focus
Implement layered prompt/snippet resolution so the AI runtime consistently applies:
`workspace override` > `system default override` > `code default`
using the **flat drift model** (both layers anchor `baseContentHash` to code default content hash).

## Inputs
- Root plan: `docs/planning/phase-129/plan.md`
- 129a outputs:
  - `SystemPromptOverride` / `SystemPromptSnippetOverride` Prisma models (no `clientId`)
  - `requireSuperAdminUser()` helper in `lib/workspace-access.ts`
  - System prompt action contracts in `actions/system-prompt-actions.ts`
- Existing runtime plumbing:
  - `lib/ai/prompt-registry.ts` — `getAIPromptTemplate` (L1508), `getPromptWithOverrides` (L1600-1687), `computePromptMessageBaseHash` (L1529)
  - `lib/ai/prompt-runner/resolve.ts` — `resolvePromptTemplate` (L11-30), delegates to `getPromptWithOverrides`
  - `lib/ai/prompt-snippets.ts` — `getEffectiveSnippet` (L219-236), `SNIPPET_DEFAULTS` (L156)
- **Must re-read from HEAD before editing:** Phase 122 modified `lib/ai/prompt-registry.ts` (Meeting Overseer prompt tightening). Phase 119 modified `lib/ai/prompt-runner/runner.ts` (retry expansion).

## Work

### 1. Prompt templates — layered resolution in `getPromptWithOverrides()`
- File: `lib/ai/prompt-registry.ts`
- **Re-read this file from HEAD first** (Phase 122 changed template content).
- Modify `getPromptWithOverrides(promptKey, clientId)` to implement 3-tier flat resolution:

**Algorithm (flat drift model):**
```
1. Get base template from code: getAIPromptTemplate(promptKey)
2. Fetch system overrides: prisma.systemPromptOverride.findMany({ where: { promptKey } })
3. Fetch workspace overrides: prisma.promptOverride.findMany({ where: { clientId, promptKey } })
4. Build override lookup maps:
   - systemMap: `${role}:${index}` → { content, baseContentHash, updatedAt }
   - workspaceMap: `${role}:${index}` → { content, baseContentHash, updatedAt }
5. For each message in base template:
   hash = hashPromptContent(msg.content)  // code default hash
   key = `${msg.role}:${roleIndex}`

   wsOverride = workspaceMap.get(key)
   sysOverride = systemMap.get(key)

   if (wsOverride && wsOverride.baseContentHash === hash):
     → use workspace content
     → track as workspace override for telemetry
   else if (sysOverride && sysOverride.baseContentHash === hash):
     → use system content
     → track as system override for telemetry
   else:
     → use code default
```

- **Return shape expansion:** Add `systemOverrideVersion` alongside existing `overrideVersion`:
  ```typescript
  {
    template: AIPromptTemplate;
    overrideVersion: string | null;      // workspace override telemetry suffix
    systemOverrideVersion: string | null; // system override telemetry suffix (new)
    hasOverrides: boolean;               // workspace overrides applied
    hasSystemOverrides: boolean;         // system overrides applied (new)
  }
  ```

### 2. Telemetry key suffixes
- File: `lib/ai/prompt-registry.ts` (within `getPromptWithOverrides`)
- **Exact formats (locked):**
  - No override: `<promptKey>` (unchanged)
  - System override only: `<promptKey>.sys_<YYYYMMDDTHHMM>` (e.g., `sentiment.classify.v1.sys_202602091430`)
  - Workspace override (with or without system): `<promptKey>.ws_<YYYYMMDDTHHMM>`
  - Workspace takes priority in telemetry key (since it's the effective content)
- Update the `overrideVersion` computation (L1677-1680) to use `ws_` prefix instead of `ovr_`:
  ```typescript
  const overrideVersion = appliedWsCount > 0 && newestWsUpdatedAt
    ? `ws_${newestWsUpdatedAt.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
    : appliedSysCount > 0 && newestSysUpdatedAt
      ? `sys_${newestSysUpdatedAt.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
      : null;
  ```
- **Note:** Existing `resolvePromptTemplate()` in `lib/ai/prompt-runner/resolve.ts` delegates to `getPromptWithOverrides()` — no changes needed there. Verify this after implementation.

### 3. Prompt snippets — 3-tier resolution in `getEffectiveSnippet()`
- File: `lib/ai/prompt-snippets.ts`
- Modify `getEffectiveSnippet(snippetKey, clientId)` to check 3 tiers:

**Updated algorithm:**
```
1. const defaultValue = SNIPPET_DEFAULTS[snippetKey];
   if (!defaultValue) return null;

2. // Check workspace override first (highest priority)
   const wsOverride = await prisma.promptSnippetOverride.findUnique({
     where: { clientId_snippetKey: { clientId, snippetKey } }
   });
   if (wsOverride) return { content: wsOverride.content, source: "workspace", updatedAt: wsOverride.updatedAt };

3. // Check system override second
   const sysOverride = await prisma.systemPromptSnippetOverride.findUnique({
     where: { snippetKey }
   });
   if (sysOverride) return { content: sysOverride.content, source: "system", updatedAt: sysOverride.updatedAt };

4. // Fall back to code default
   return { content: defaultValue, source: "code", updatedAt: null };
```

- **Return type change:** Replace `isOverride: boolean` with `source: "workspace" | "system" | "code"`.
  - Backward compatibility: callers using `isOverride` must be updated. Search for all callers of `getEffectiveSnippet` and update them.
  - `getEffectiveForbiddenTerms()` (L242) wraps this — update it too.

### 4. Backward compatibility verification
- Existing workspace overrides must continue working identically when no system overrides exist:
  - `getPromptWithOverrides()`: if `systemPromptOverride.findMany()` returns empty, behavior matches pre-Phase-129 exactly.
  - `getEffectiveSnippet()`: if `systemPromptSnippetOverride.findUnique()` returns null, falls through to code default (same as before).
- "Reset workspace override" behavior naturally falls back to system defaults (if present) because the workspace row is deleted and the next resolution picks up the system layer.
- **Verify:** Run existing tests (`npm test`) after changes — no regressions.

## Validation (RED TEAM)
- Run `npm test` — all existing tests pass (no regressions).
- Run `npm run lint` — no errors.
- Run `npm run build` — succeeds.
- Manual check: read `lib/ai/prompt-runner/resolve.ts` and confirm `resolvePromptTemplate()` still works (delegates to updated `getPromptWithOverrides`).
- Manual check: verify Phase 119's retry expansion in `lib/ai/prompt-runner/runner.ts` is untouched.

## Output
- `getPromptWithOverrides()` implements 3-tier flat-model resolution for prompt templates.
- `getEffectiveSnippet()` implements 3-tier resolution for snippets with explicit `source` field.
- Telemetry prompt keys distinguish: no override vs `sys_<ts>` vs `ws_<ts>`.
- Existing workspace overrides continue working unchanged.
- `resolvePromptTemplate()` inherits changes automatically (no direct edits needed).

## Handoff
Provide to 129c:
- Effective source determination rules: workspace (blue) > system (amber) > code (gray)
- `getPromptWithOverrides` return shape with `hasSystemOverrides` / `systemOverrideVersion`
- `getEffectiveSnippet` return shape with `source: "workspace"|"system"|"code"`
- Stale detection rule for UI: `workspaceOverride.updatedAt < systemOverride.updatedAt` → show amber "System default changed" badge
- No new action endpoints needed beyond what 129a provides

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented 3-tier prompt template resolution (workspace > system > code) with flat drift checks and telemetry suffixing. (`lib/ai/prompt-registry.ts`)
  - Exported `applyFlatPromptOverrides()` for unit testing of precedence/drift + telemetry suffix logic. (`lib/ai/prompt-registry.ts`)
  - Implemented 3-tier snippet resolution (workspace > system > code). (`lib/ai/prompt-snippets.ts`)
- Commands run:
  - `npm test` — pass (covered in 129d)
  - `npm run build` — pass (covered in 129d)
- Blockers:
  - None
- Next concrete steps:
  - Ensure Settings UI reflects effective sources + stale warnings (129c) and keep tests/build green (129d).
