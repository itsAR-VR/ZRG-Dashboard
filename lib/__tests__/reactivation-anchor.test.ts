import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isEmailBisonSentFolder, pickReactivationAnchorFromReplies } from "../reactivation-anchor";

describe("reactivation-anchor", () => {
  describe("isEmailBisonSentFolder", () => {
    it("treats 'sent' and 'outbox' folders as sent", () => {
      assert.equal(isEmailBisonSentFolder("Sent"), true);
      assert.equal(isEmailBisonSentFolder("sent"), true);
      assert.equal(isEmailBisonSentFolder("Outbox"), true);
      assert.equal(isEmailBisonSentFolder("outgoing"), true);
      assert.equal(isEmailBisonSentFolder("inbox"), false);
      assert.equal(isEmailBisonSentFolder(null), false);
    });
  });

  describe("pickReactivationAnchorFromReplies", () => {
    it("picks newest sent reply matching desired campaign_id when available", () => {
      const result = pickReactivationAnchorFromReplies({
        desiredCampaignId: "123",
        replies: [
          {
            id: 1,
            folder: "sent",
            campaign_id: 123,
            sender_email_id: 10,
            created_at: "2026-01-01T00:00:00Z",
          },
          {
            id: 2,
            folder: "sent",
            campaign_id: 123,
            sender_email_id: 11,
            created_at: "2026-01-02T00:00:00Z",
          },
          {
            id: 3,
            folder: "sent",
            campaign_id: 999,
            sender_email_id: 99,
            created_at: "2026-01-03T00:00:00Z",
          },
        ] as any,
      });

      assert.ok(result);
      assert.equal(result.anchorReplyId, "2");
      assert.equal(result.originalSenderEmailId, "11");
      assert.equal(result.anchorCampaignId, "123");
      assert.equal(result.anchorKind, "sent_campaign_match");
    });

    it("falls back to newest sent reply even when campaign_id is missing or mismatched", () => {
      const result = pickReactivationAnchorFromReplies({
        desiredCampaignId: "123",
        replies: [
          {
            id: 10,
            folder: "sent",
            campaign_id: 999,
            sender_email_id: 50,
            created_at: "2026-01-01T00:00:00Z",
          },
          {
            id: 11,
            folder: "Outbox",
            campaign_id: null,
            sender_email_id: null,
            created_at: "2026-01-02T00:00:00Z",
          },
        ] as any,
      });

      assert.ok(result);
      assert.equal(result.anchorReplyId, "11");
      assert.equal(result.originalSenderEmailId, null);
      assert.equal(result.anchorCampaignId, null);
      assert.equal(result.anchorKind, "sent_any");
    });

    it("falls back to newest reply in any folder when no sent replies exist", () => {
      const result = pickReactivationAnchorFromReplies({
        desiredCampaignId: "123",
        replies: [
          { id: 5, folder: "inbox", created_at: "2026-01-01T00:00:00Z" },
          { id: 6, folder: "inbox", created_at: "2026-01-03T00:00:00Z", sender_email_id: 77 },
        ] as any,
      });

      assert.ok(result);
      assert.equal(result.anchorReplyId, "6");
      assert.equal(result.originalSenderEmailId, "77");
      assert.equal(result.anchorKind, "any_folder");
    });
  });
});

