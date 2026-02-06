# Phase 112a — Contract: LeadContextBundle (Format, Redaction, Budgets, Injection Mapping)

## Focus
Define a single, explicit **LeadContextBundle** contract that every AI step can consume:
- drafting (email/sms/linkedin)
- meeting overseer (gate only; extraction stays lean)
- auto-send evaluator
- followup-engine parsing + booking gate

The contract must be multi-tenant safe, PII-safe, and compatible with prompt overrides (no prompt-key bumps for existing keys).

## Inputs
- Drafting + overseer:
  - `lib/ai-drafts.ts`
  - `lib/meeting-overseer.ts`
- Auto-send evaluator:
  - `lib/auto-send-evaluator.ts`
  - `lib/auto-send-evaluator-input.ts`
- Followups / booking:
  - `lib/followup-engine.ts`
- Context primitives:
  - `lib/knowledge-asset-context.ts`
  - `lib/lead-memory-context.ts`
- Telemetry:
  - `lib/ai/openai-telemetry.ts`
  - `prisma/schema.prisma` (`AIInteraction`)

## Decisions (Locked 2026-02-06)
- Bundle serialization: **plain-text sections** (Markdown-friendly).
- Auto-send evaluator includes **redacted** lead memory.
- Meeting overseer extraction stays lean (no memory); gate uses memory.
- Rollout: DB-backed per-workspace toggle (super-admin only) + env kill-switch.
- Telemetry sink: AIInteraction **metadata** (requires schema + plumbing).

## LeadContextBundle v1 (Contract)

### Type shape (TypeScript)
Proposed module: `lib/lead-context-bundle.ts`

```ts
export type LeadContextProfile =
  | "draft"
  | "auto_send_evaluator"
  | "meeting_overseer_gate"
  | "followup_parse"
  | "followup_booking_gate";

export type LeadContextBundle = {
  clientId: string;
  leadId: string;
  profile: LeadContextProfile;

  // Verified workspace context (pricing/service claims).
  serviceDescription: string | null;
  goals: string | null;

  // Knowledge assets (token-budgeted). EXCLUDES `Primary: Website URL`.
  knowledgeContext: string | null;
  primaryWebsiteUrl: string | null;

  // Lead memory (token-budgeted; redacted for all profiles except "draft").
  leadMemoryContext: string | null;

  stats: {
    knowledge?: {
      maxTokens: number;
      maxAssetTokens: number;
      totalAssets: number;
      includedAssets: number;
      truncatedAssets: number;
      totalTokensEstimated: number;
    };
    memory?: {
      maxTokens: number;
      maxEntryTokens: number;
      totalEntries: number;
      includedEntries: number;
      truncatedEntries: number;
      totalTokensEstimated: number;
    };
    totals: { tokensEstimated: number };
  };
};
```

### Formatting rules (plain text)
- `knowledgeContext`: output of `buildKnowledgeContextFromAssets(...)`
  - header per asset: `[Asset Name]`
  - body: truncated asset text
- `leadMemoryContext`: output of `getLeadMemoryContext({ redact })` where:
  - `draft` profile: `redact: false` (matches current drafting behavior — unredacted for better AI responses)
  - all other profiles: `redact: true` (PII-safe for evaluation/gating contexts)
  - header per entry: `[Category]` (default: `Note`)
  - body: truncated entry text (with PII redaction applied when `redact: true`)
- `primaryWebsiteUrl`: derived via `extractPrimaryWebsiteUrlFromAssets`
  - hard rule: do NOT include the website URL asset inside `knowledgeContext`

### Budgets and profiles (defaults)
Budgets are stored in `WorkspaceSettings` and can be tuned in the super-admin control plane UI.

Profile defaults (initial):
- `draft`:
  - include: serviceDescription, goals, knowledgeContext, leadMemoryContext
  - knowledge: `maxTokens=4000`, `maxAssetTokens=1200`
  - memory: `maxTokens=1200`, `maxEntryTokens=400`
- `auto_send_evaluator`:
  - include: serviceDescription, goals, knowledgeContext, leadMemoryContext
  - knowledge: `maxTokens=8000`, `maxAssetTokens=1600` (match current evaluator)
  - memory: `maxTokens=600`, `maxEntryTokens=300`
- `meeting_overseer_gate`:
  - include: leadMemoryContext only
  - memory: `maxTokens=600`, `maxEntryTokens=300`
- `followup_parse`:
  - include: leadMemoryContext only
  - memory: `maxTokens=400`, `maxEntryTokens=200`
- `followup_booking_gate`:
  - include: leadMemoryContext only
  - memory: `maxTokens=600`, `maxEntryTokens=300`

## Injection mapping (exact)

### Drafting (`lib/ai-drafts.ts`)
- Keep passing `serviceDescription`, `aiGoals`, and `primaryWebsiteUrl` via existing prompt vars.
- Set existing prompt var `knowledgeContext` to:
  - `bundle.knowledgeContext`, plus if `bundle.leadMemoryContext` exists append:
    - `\n\nLEAD MEMORY:\n${bundle.leadMemoryContext}`
- Transcript formatting is out of scope: drafting already uses a preformatted transcript string.

### Meeting overseer gate (`lib/meeting-overseer.ts`)
- Pass `memoryContext = bundle.leadMemoryContext ?? "None."` to `runMeetingOverseerGate`.
- Do not inject bundle into `runMeetingOverseerExtraction` (extraction stays lean).

### Auto-send evaluator (`lib/auto-send-evaluator-input.ts`)
- Preserve existing top-level keys in evaluator input JSON:
  - `service_description`, `goals`, `knowledge_context`, `verified_context_instructions`
- Add one new top-level key (additive only):
  - `lead_memory_context` (redacted)

### Followup-engine (`lib/followup-engine.ts`)
- Add prompt templates to registry for:
  - `followup.parse_proposed_times.v1`
  - `followup.booking.gate.v1` (new)
- Inject `leadMemoryContext` as a dedicated template var in those prompts.
- Move confidence thresholds out of hardcoded constants and into settings/policy (see 112f + 112d).

## Telemetry metadata contract (stats-only)
All AI calls that used a bundle must attach this metadata to `AIInteraction.metadata`:
```json
{
  "leadContextBundle": {
    "version": "lead_context_bundle.v1",
    "profile": "auto_send_evaluator",
    "knowledge": { "includedAssets": 3, "truncatedAssets": 1, "totalTokensEstimated": 2100 },
    "memory": { "includedEntries": 4, "truncatedEntries": 2, "totalTokensEstimated": 580 },
    "totals": { "tokensEstimated": 3200 }
  }
}
```

Hard rules:
- Metadata must never include raw message text, raw lead memory text, or knowledge asset contents.
- Metadata may include counts/booleans and (optionally) a short allowlisted list of asset names (max 10), but default is stats-only.

## Output
- This doc is the final, executable spec for the bundle contract + injection mapping + telemetry metadata.

## Handoff
112b implements `lib/lead-context-bundle.ts` and wires it into drafting + meeting overseer gate, while adding AIInteraction metadata plumbing.
