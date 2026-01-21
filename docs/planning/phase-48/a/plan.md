# Phase 48a — Types and Interfaces Extraction

## Focus

Create a shared types module (`lib/auto-send/types.ts`) that defines all the interfaces, types, and constants needed by the auto-send orchestrator. This establishes the contract between the orchestrator and its callers.

## Inputs

- Current inline types scattered across:
  - `lib/auto-send-evaluator.ts` → `AutoSendEvaluation`
  - `lib/auto-reply-gate.ts` → `AutoReplyDecision`
  - `lib/background-jobs/delayed-auto-send.ts` → `DelayedAutoSendParams`
  - Background job files (implicit types for lead/campaign context)

## Work

1. **Create directory structure:**
   ```
   lib/auto-send/
   ├── types.ts      ← This subphase
   ├── orchestrator.ts
   ├── index.ts
   └── __tests__/
       └── orchestrator.test.ts
   ```

2. **Define `AutoSendMode` enum:**
   ```typescript
   export type AutoSendMode =
     | "AI_AUTO_SEND"      // EmailCampaign confidence-based mode
     | "LEGACY_AUTO_REPLY" // Per-lead boolean mode
     | "DISABLED";         // No auto-send
   ```

3. **Define `AutoSendOutcome` discriminated union:**
   ```typescript
   export type AutoSendOutcome =
     | { action: "send_immediate"; draftId: string; messageId?: string }
     | { action: "send_delayed"; draftId: string; runAt: Date; jobId?: string }
     | { action: "needs_review"; draftId: string; reason: string; confidence: number }
     | { action: "skip"; reason: string }
     | { action: "error"; error: string };
   ```

4. **Define `AutoSendContext` interface:**
   ```typescript
   export interface AutoSendContext {
     // Identity
     clientId: string;
     leadId: string;
     triggerMessageId: string;
     draftId: string;
     draftContent: string;

     // Channel context
     channel: "email" | "sms" | "linkedin";
     latestInbound: string;
     subject?: string | null;
     conversationHistory: string;
     sentimentTag: string | null;
     messageSentAt: Date;
     automatedReply?: boolean | null;

     // Lead info (for Slack notifications)
     leadFirstName?: string | null;
     leadLastName?: string | null;
     leadEmail?: string | null;

     // Campaign context (determines which path)
     emailCampaign?: {
       id: string;
       name: string;
       bisonCampaignId: string | null;
       responseMode: string | null;
       autoSendConfidenceThreshold: number;
     } | null;

     // Legacy per-lead flag
     autoReplyEnabled?: boolean;
   }
   ```

5. **Define `AutoSendResult` interface:**
   ```typescript
   export interface AutoSendResult {
     mode: AutoSendMode;
     outcome: AutoSendOutcome;
     telemetry: AutoSendTelemetry;
   }

   export interface AutoSendTelemetry {
     path: "campaign_ai_auto_send" | "legacy_per_lead" | "disabled";
     evaluationTimeMs?: number;
     confidence?: number;
     threshold?: number;
     delaySeconds?: number;
     skipReason?: string;
   }
   ```

6. **Re-export existing types for convenience:**
   ```typescript
   // Re-export so consumers don't need to import from multiple places
   export type { AutoSendEvaluation } from "@/lib/auto-send-evaluator";
   export type { AutoReplyDecision } from "@/lib/auto-reply-gate";
   ```

7. **Define constants:**
   ```typescript
   export const AUTO_SEND_CONSTANTS = {
     // Hardcoded notification recipient (future: make configurable)
     REVIEW_NOTIFICATION_EMAIL: "jon@zeroriskgrowth.com",

     // Default confidence threshold if not set on campaign
     DEFAULT_CONFIDENCE_THRESHOLD: 0.9,

     // Delay bounds (seconds)
     MIN_DELAY_SECONDS: 0,
     MAX_DELAY_SECONDS: 3600, // 60 minutes
   } as const;
   ```

8. **Validation:**
   - Run `npm run lint` on new file
   - Ensure types are importable

## Output

- `lib/auto-send/types.ts` created with all shared types
- Types are strict (no `any`)
- JSDoc comments explain each type's purpose
- No runtime code (pure type definitions + constants)

## Handoff

Types are ready for subphase b to implement the orchestrator using these interfaces.
