// Shared (client-safe) sentiment constants and helpers.
// Keep this file free of server-only imports so it can be used in client components.

export const SENTIMENT_TAGS = [
  "New", // No inbound replies yet
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Not Interested",
  "Blacklist",
  "Follow Up",
  "Out of Office",
  "Automated Reply",
  "Interested",
  "Neutral",
  "Snoozed", // Temporarily hidden from follow-up list
] as const;

export type SentimentTag = (typeof SENTIMENT_TAGS)[number];

// Map sentiment tags to lead statuses
export const SENTIMENT_TO_STATUS: Record<SentimentTag, string> = {
  New: "new",
  "Meeting Requested": "meeting-requested",
  "Call Requested": "qualified",
  "Information Requested": "qualified",
  "Not Interested": "not-interested",
  Blacklist: "blacklisted",
  "Follow Up": "new",
  "Out of Office": "new",
  "Automated Reply": "new",
  Interested: "qualified",
  Neutral: "new",
  Snoozed: "new",
};

// Positive sentiments that trigger enrichment / drafting behavior
export const POSITIVE_SENTIMENTS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Interested",
] as const;

export type PositiveSentiment = (typeof POSITIVE_SENTIMENTS)[number];

export function isPositiveSentiment(tag: string | null): tag is PositiveSentiment {
  if (!tag) return false;
  return POSITIVE_SENTIMENTS.includes(tag as PositiveSentiment);
}

