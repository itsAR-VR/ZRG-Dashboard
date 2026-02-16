import "server-only";

export const GLOBAL_SCOPE_USER_ID = "00000000-0000-0000-0000-000000000000";

export const INBOX_COUNTS_STALE_MS = 5 * 60 * 1000;

export type InboxCountsSnapshot = {
  allResponses: number;
  requiresAttention: number;
  previouslyRequiredAttention: number;
  awaitingReply: number;
  needsRepair: number;
  aiSent: number;
  aiReview: number;
  total: number;
};
