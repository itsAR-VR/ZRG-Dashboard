export type ReplayChannel = "email" | "sms" | "linkedin";
export type ReplayChannelFilter = ReplayChannel | "any";
export type ReplayRevisionLoopMode = "platform" | "force" | "off";
export type ReplayOverseerDecisionMode = "fresh" | "persisted";
export type ReplayJudgeProfile = "strict" | "balanced" | "lenient";

export type ReplaySelectionSource = "auto_risk_ranked" | "explicit_thread_ids";

export type ReplayRiskReason =
  | "pricing_keyword"
  | "cadence_keyword"
  | "dollar_amount"
  | "information_requested"
  | "follow_up"
  | "meeting_requested"
  | "recent_inbound"
  | "explicit_thread_id";

export type ReplaySelectionCase = {
  caseId: string;
  messageId: string;
  leadId: string;
  clientId: string;
  channel: ReplayChannel;
  sentAt: string;
  leadName: string;
  leadEmail: string | null;
  leadSentiment: string;
  inboundSubject: string | null;
  inboundBody: string;
  riskScore: number;
  riskReasons: ReplayRiskReason[];
  selectionSource: ReplaySelectionSource;
};

export type ReplaySelectionResult = {
  cases: ReplaySelectionCase[];
  warnings: string[];
  scannedCount: number;
};

export type ReplayJudgeInput = {
  channel: ReplayChannel;
  leadSentiment: string;
  inboundSubject: string | null;
  inboundBody: string;
  conversationTranscript: string;
  generatedDraft: string;
  serviceDescription: string | null;
  knowledgeContext: string | null;
  companyName: string | null;
  targetResult: string | null;
  observedNextOutbound: {
    subject: string | null;
    body: string;
    sentAt: string;
    source: string | null;
  } | null;
  historicalReplyExamples: Array<{
    subject: string | null;
    body: string;
    sentAt: string;
    leadSentiment: string | null;
  }>;
};

export type ReplayJudgeScore = {
  pass: boolean;
  judgeMode: "hybrid_v1";
  judgeProfile: ReplayJudgeProfile;
  judgeThreshold: number;
  confidence: number;
  llmPass: boolean;
  llmOverallScore: number;
  objectivePass: boolean;
  objectiveOverallScore: number;
  objectiveCriticalReasons: string[];
  blendedScore: number;
  adjudicated: boolean;
  adjudicationBand: {
    min: number;
    max: number;
  };
  overallScore: number;
  promptKey: string;
  promptClientId: string | null;
  systemPrompt: string;
  dimensions: {
    pricingCadenceAccuracy: number;
    factualAlignment: number;
    safetyAndPolicy: number;
    responseQuality: number;
  };
  failureReasons: string[];
  suggestedFixes: string[];
  summary: string;
};

export type ReplayCaseStatus = "selected_only" | "skipped" | "evaluated" | "failed";
export type ReplayFailureType =
  | "decision_error"
  | "draft_generation_error"
  | "draft_quality_error"
  | "judge_error"
  | "infra_error"
  | "selection_error"
  | "execution_error"
  | null;
export type ReplayFailureTypeKey = Exclude<ReplayFailureType, null>;

export type ReplayInvariantCode =
  | "slot_mismatch"
  | "date_mismatch"
  | "fabricated_link"
  | "empty_draft"
  | "non_logistics_reply";

export type ReplayInvariantFailure = {
  code: ReplayInvariantCode;
  message: string;
  severity: "critical";
};

export type ReplayEvidencePacket = {
  caseId: string;
  channel: ReplayChannel;
  failureType: ReplayFailureType;
  inbound: {
    leadSentiment: string;
    subject: string | null;
    body: string;
    transcript: string | null;
  };
  decisionContract: Record<string, unknown> | null;
  generation: {
    status: "generated" | "skipped" | "failed";
    draftId: string | null;
    content: string | null;
    error: string | null;
  };
  judge: {
    promptKey: string;
    systemPrompt: string;
    promptClientId: string | null;
    pass: boolean | null;
    overallScore: number | null;
    failureReasons: string[];
  };
  invariants: ReplayInvariantFailure[];
  references: {
    artifactPath: string | null;
    historicalOutbound: string | null;
    notes: string | null;
  };
};

export type ReplayCaseResult = {
  caseId: string;
  messageId: string;
  leadId: string;
  clientId: string;
  channel: ReplayChannel;
  status: ReplayCaseStatus;
  attempts: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  leadSentiment: string;
  inboundSubject: string | null;
  inboundBody: string;
  transcript: string | null;
  generation: {
    draftId: string | null;
    runId: string | null;
  } | null;
  revisionLoop: {
    mode: ReplayRevisionLoopMode;
    enabled: boolean;
    attempted: boolean;
    applied: boolean;
    iterationsUsed: number;
    threshold: number | null;
    startConfidence: number | null;
    endConfidence: number | null;
    stopReason: "disabled" | "not_applicable" | "threshold_met" | "hard_block" | "no_improvement" | "exhausted" | "error";
    finalReason: string | null;
  } | null;
  generatedDraft: string | null;
  judge: ReplayJudgeScore | null;
  invariants: ReplayInvariantFailure[];
  failureType: ReplayFailureType;
  evidencePacket: ReplayEvidencePacket | null;
  skipReason: string | null;
  error: string | null;
  warnings: string[];
};

export type ReplayBaselineDiffCase = {
  caseId: string;
  previousPass: boolean | null;
  currentPass: boolean | null;
  previousScore: number | null;
  currentScore: number | null;
  delta: number | null;
  classification: "improved" | "regressed" | "unchanged" | "new_case";
};

export type ReplayBaselineDiff = {
  baselinePath: string;
  summary: {
    improved: number;
    regressed: number;
    unchanged: number;
    newCases: number;
  };
  cases: ReplayBaselineDiffCase[];
};

export type ReplayRunArtifact = {
  runId: string;
  createdAt: string;
  config: {
    clientId: string | null;
    judgeClientId: string | null;
    threadIds: string[];
    threadIdsFile: string | null;
    channel: ReplayChannelFilter;
    from: string;
    to: string;
    limit: number;
    concurrency: number;
    retries: number;
    dryRun: boolean;
    cleanupDrafts: boolean;
    allowEmpty: boolean;
    revisionLoopMode: ReplayRevisionLoopMode;
    overseerDecisionMode: ReplayOverseerDecisionMode;
    abModes: ReplayRevisionLoopMode[];
    judgeModel: string | null;
    judgeProfile: ReplayJudgeProfile;
    judgeThreshold: number;
    adjudicationBand: {
      min: number;
      max: number;
    };
    adjudicateBorderline: boolean;
    judgePromptKey: string;
    judgeSystemPrompt: string;
  };
  selection: {
    count: number;
    scannedCount: number;
    warnings: string[];
  };
  summary: {
    selectedOnly: number;
    skipped: number;
    evaluated: number;
    failed: number;
    passed: number;
    failedJudge: number;
    averageScore: number | null;
    failureTypeCounts: Record<ReplayFailureTypeKey, number>;
    criticalMisses: number;
    criticalInvariantCounts: Record<ReplayInvariantCode, number>;
  };
  cases: ReplayCaseResult[];
  baselineDiff: ReplayBaselineDiff | null;
  abComparison: {
    modes: Record<
      ReplayRevisionLoopMode,
      {
        summary: ReplayRunArtifact["summary"];
        casesEvaluated: number;
      }
    >;
    caseDeltas: Array<{
      caseId: string;
      byMode: Record<
        ReplayRevisionLoopMode,
        {
          pass: boolean | null;
          score: number | null;
          criticalInvariantCodes: ReplayInvariantCode[];
          failureType: ReplayFailureType;
        }
      >;
    }>;
  } | null;
};
