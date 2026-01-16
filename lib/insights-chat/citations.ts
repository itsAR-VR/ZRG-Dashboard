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
};

