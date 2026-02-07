export type AutoSendMode =
  | "AI_AUTO_SEND" // EmailCampaign confidence-based mode
  | "LEGACY_AUTO_REPLY" // Per-lead boolean mode
  | "DISABLED"; // No auto-send

export type AutoSendPath = "campaign_ai_auto_send" | "legacy_per_lead" | "disabled";

export type AutoSendOutcome =
  | { action: "send_immediate"; draftId: string; messageId?: string }
  | { action: "send_delayed"; draftId: string; runAt: Date }
  | {
      action: "needs_review";
      draftId: string;
      reason: string;
      confidence: number;
      threshold: number;
      slackDm: {
        sent: boolean;
        skipped?: boolean;
        error?: string;
        // Phase 70: Include message metadata for interactive button updates
        messageTs?: string;
        channelId?: string;
      };
    }
  | { action: "skip"; reason: string }
  | { action: "error"; error: string };

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
  leadTimezone?: string | null;

  // Campaign context (determines which path)
  emailCampaign?: {
    id: string;
    name: string;
    bisonCampaignId: string | null;
    responseMode: string | null;
    autoSendConfidenceThreshold: number;
    autoSendScheduleMode?: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null;
    autoSendCustomSchedule?: unknown;
  } | null;

  // Legacy per-lead flag
  autoReplyEnabled?: boolean;

  workspaceSettings?: {
    timezone?: string | null;
    workStartTime?: string | null;
    workEndTime?: string | null;
    autoSendScheduleMode?: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null;
    autoSendCustomSchedule?: unknown;
    autoSendRevisionEnabled?: boolean | null;
  } | null;

  // Behavior toggles to preserve per-job semantics
  validateImmediateSend?: boolean;
  includeDraftPreviewInSlack?: boolean;
}

export interface AutoSendTelemetry {
  path: AutoSendPath;
  evaluationTimeMs?: number;
  confidence?: number;
  threshold?: number;
  delaySeconds?: number;
  delayedScheduleSkipReason?: string;
  immediateValidationSkipReason?: string;
}

export interface AutoSendResult {
  mode: AutoSendMode;
  outcome: AutoSendOutcome;
  telemetry: AutoSendTelemetry;
}

export const AUTO_SEND_CONSTANTS = {
  DEFAULT_CONFIDENCE_THRESHOLD: 0.9,
} as const;

export type { AutoSendEvaluation } from "@/lib/auto-send-evaluator";
export type { AutoReplyDecision } from "@/lib/auto-reply-gate";
