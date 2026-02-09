export const DRAFT_PIPELINE_RUN_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "ABORTED"] as const;
export type DraftPipelineRunStatus = (typeof DRAFT_PIPELINE_RUN_STATUSES)[number];

export const DRAFT_PIPELINE_STAGES = {
  draftStrategyStep1: "draft_strategy_step1",
  draftGenerationStep2: "draft_generation_step2",
  draftVerifierStep3: "draft_verifier_step3",
  meetingOverseerExtract: "meeting_overseer_extract",
  meetingOverseerGate: "meeting_overseer_gate",
  autoSendEvaluation: "auto_send_evaluation",
  autoSendRevisionSelector: "auto_send_revision_selector",
  autoSendRevisionReviser: "auto_send_revision_reviser",
  autoSendRevisionLoop: "auto_send_revision_loop",
  memoryProposal: "memory_proposal",
  finalDraft: "final_draft",
  loopError: "loop_error",
} as const;

export type DraftPipelineStage = (typeof DRAFT_PIPELINE_STAGES)[keyof typeof DRAFT_PIPELINE_STAGES];

export type DraftRunContextPackSection = {
  label: string;
  content: string;
};

export type DraftRunContextPackStats = {
  primaryChars: number;
  secondaryChars: number;
  tertiaryChars: number;
  totalChars: number;
};

export type DraftRunContextPack = {
  runId: string;
  iteration: number;
  primary: DraftRunContextPackSection[];
  secondary: DraftRunContextPackSection[];
  tertiary: DraftRunContextPackSection[];
  stats: DraftRunContextPackStats;
};
