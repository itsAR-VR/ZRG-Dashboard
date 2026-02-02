# Phase 93b — Persona Tokens in Follow-Up Templates

## Focus
Enable follow-up workflows to include persona-based content (especially signatures) by adding a `{signature}` token and resolving `{senderName}` / `{signature}` from the effective AI persona, not only from workspace settings.

## Inputs
* Phase 93a output: `FollowUpSequence.aiPersonaId` exists (nullable).
* Current token system: `lib/followup-template.ts`, `lib/__tests__/followup-template.test.ts`
* Current follow-up message generation: `lib/followup-engine.ts` (`generateFollowUpMessage`)
* Current persona system: `prisma/schema.prisma` (`AiPersona`), `actions/ai-persona-actions.ts`, campaign assignment UI (`components/dashboard/settings/ai-campaign-assignment.tsx`)

## Work

### 1. Token additions

In `lib/followup-template.ts`:

1. Add to `FollowUpTemplateValueKey` union: `"signature"`
2. Add token definition:
   ```typescript
   { token: "{signature}", valueKey: "signature", source: "workspace" }
   ```

### 2. Create persona value resolver

Create `lib/persona-value-resolver.ts`:

```typescript
/**
 * Resolves persona values (senderName, signature) using a 4-tier fallback:
 * 1. Sequence persona (if sequence has aiPersonaId)
 * 2. Campaign persona (from lead's EmailCampaign.aiPersonaId)
 * 3. Default persona (AiPersona.isDefault = true for workspace)
 * 4. Workspace settings (aiPersonaName, aiSignature)
 */
export async function resolvePersonaValues(opts: {
  sequenceAiPersonaId?: string | null;
  campaignAiPersonaId?: string | null;
  clientId: string;
  workspaceSettings: WorkspaceSettings | null;
}): Promise<{ senderName: string | null; signature: string | null }>
```

Resolution logic:
1. If `sequenceAiPersonaId` provided, load that persona
2. Else if `campaignAiPersonaId` provided, load that persona
3. Else load default persona (`AiPersona.isDefault = true` for `clientId`)
4. If no persona found, fall back to workspace settings

Return:
- `senderName`: `persona?.personaName ?? persona?.name ?? workspaceSettings?.aiPersonaName ?? null`
- `signature`: `persona?.signature ?? workspaceSettings?.aiSignature ?? null`

### 3. Integrate into follow-up engine

In `lib/followup-engine.ts`:

1. Update `generateFollowUpMessage` signature to accept optional persona context:
   ```typescript
   export async function generateFollowUpMessage(
     step: FollowUpStepData,
     lead: LeadContext,
     settings: WorkspaceSettings | null,
     personaContext?: { senderName: string | null; signature: string | null }
   ): Promise<GenerateFollowUpMessageResult>
   ```

2. In value resolution (lines 556-571):
   ```typescript
   const values: FollowUpTemplateValues = {
     // ... existing fields ...
     aiPersonaName: personaContext?.senderName ?? settings?.aiPersonaName ?? null,
     signature: personaContext?.signature ?? null,  // NEW
   };
   ```

3. Update `processNextFollowUpForInstance` to pre-resolve persona context:
   ```typescript
   const personaContext = await resolvePersonaValues({
     sequenceAiPersonaId: instance.sequence.aiPersonaId,
     campaignAiPersonaId: lead.emailCampaign?.aiPersonaId,
     clientId: lead.clientId,
     workspaceSettings: settings,
   });
   ```

### 4. Strict gating (Phase 73 policy)

No additional work needed — existing `renderFollowUpTemplateStrict` will:
- Add `{signature}` to `templateErrors` if value is null/empty but token is used
- Trigger instance pause via `buildTemplateBlockedPauseReason`

### 5. Tests

Extend `lib/__tests__/followup-template.test.ts`:

```typescript
describe("{signature} token", () => {
  test("renders signature when provided", () => {
    const result = renderFollowUpTemplateStrict({
      template: "Best,\n{signature}",
      values: { ...BASE_VALUES, signature: "— John Doe\nCEO, Acme Inc" },
    });
    expect(result.ok).toBe(true);
    expect(result.rendered).toContain("— John Doe");
  });

  test("blocks when signature is missing", () => {
    const result = renderFollowUpTemplateStrict({
      template: "Best,\n{signature}",
      values: { ...BASE_VALUES, signature: null },
    });
    expect(result.ok).toBe(false);
    expect(result.templateErrors).toContainEqual(
      expect.objectContaining({ type: "missing_value", token: "{signature}" })
    );
  });
});
```

## Validation (RED TEAM)

- [ ] `{signature}` token added to `FOLLOWUP_TEMPLATE_TOKEN_DEFINITIONS`
- [ ] `"signature"` added to `FollowUpTemplateValueKey` union
- [ ] `resolvePersonaValues` helper created with 4-tier fallback
- [ ] `generateFollowUpMessage` accepts optional `personaContext`
- [ ] `processNextFollowUpForInstance` pre-resolves persona context
- [ ] Tests cover render success and missing value blocking
- [ ] `npm run test` passes

## Output
* Added `{signature}` token support in `lib/followup-template.ts`, including missing-value hints.
* Added `lib/followup-persona.ts` with `resolveFollowUpPersonaContext(...)` to resolve sender/signature using sequence/campaign/default persona with settings fallback.
* Updated `lib/followup-engine.ts` to inject persona-driven `{senderName}` + `{signature}` into follow-up template values and classify missing signatures as workspace setup issues.
* Updated `lib/__tests__/followup-template.test.ts` to cover `{signature}` rendering and missing-value blocking.

## Handoff
Phase 93c can now auto-start persona-specific sequences confident that the follow-up engine will render the right sender/signature for the chosen workflow.

## Coordination Notes

**Unrelated working tree changes detected:** `lib/availability-cache.ts`, `scripts/backfill-ai-auto-send.ts`, `lib/draft-availability-refresh.ts` (left untouched).
