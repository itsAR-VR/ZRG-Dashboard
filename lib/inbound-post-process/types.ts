import "server-only";

export type InboundPostProcessChannel = "email" | "sms" | "linkedin";
export type InboundPostProcessProvider = "smartlead" | "instantly" | "emailbison";

export type InboundPostProcessAdapter = {
  channel: InboundPostProcessChannel;
  provider: InboundPostProcessProvider;
  logPrefix: string;
};

export type InboundPostProcessParams = {
  clientId: string;
  leadId: string;
  messageId: string;
  adapter: InboundPostProcessAdapter;
};

export type InboundPostProcessPipelineStage =
  | "load"
  | "build_transcript"
  | "classify_sentiment"
  | "update_lead"
  | "maybe_assign_lead"
  | "apply_auto_followup_policy"
  | "auto_start_meeting_requested"
  | "pause_followups_on_reply"
  | "cancel_timing_clarify_attempt2_on_inbound"
  | "snooze_detection"
  | "auto_booking"
  | "reject_pending_drafts"
  | "ghl_contact_sync"
  | "resume_enrichment_followups"
  | "action_signal_detection"
  | "draft_generation"
  | "bump_rollups"
  | "enqueue_lead_scoring";

export type InboundPostProcessResult = {
  stageLogs: InboundPostProcessPipelineStage[];
};
