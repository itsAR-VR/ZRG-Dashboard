export type InsightThreadCitation = {
  kind: "thread";
  ref: string;
  leadId: string;
  outcome: string | null;
  emailCampaignId: string | null;
  campaignName: string | null;
  leadLabel: string | null;
  note: string | null;
};

export type InsightThreadIndexItem = {
  ref: string;
  leadId: string;
  outcome: string;
  exampleType: "positive" | "negative";
  selectionBucket: string;
  emailCampaignId: string | null;
  campaignName: string | null;
  leadLabel: string;
  summary: string;
  /** Follow-up effectiveness score (0-105, includes objection boost), undefined if not available (Phase 29c) */
  followUpScore?: number;
  /** Whether the lead converted after handling an objection (Phase 29c) */
  convertedAfterObjection?: boolean;
};

