import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isEligibleFollowUpTaskDraftSource } from "../followup-task-drafts";

describe("isEligibleFollowUpTaskDraftSource", () => {
  it("allows sequence-scoped tasks", () => {
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        instanceId: "instance-1",
        stepOrder: 2,
        campaignName: "any",
      }),
      true
    );
  });

  it("allows follow-up timing clarification campaigns", () => {
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "Follow-up timing clarification (auto) #1",
      }),
      true
    );
  });

  it("allows only scheduled follow-up auto campaign by name", () => {
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "Scheduled follow-up (auto)",
      }),
      true
    );
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "Scheduled follow-up (manual)",
      }),
      false
    );
  });

  it("allows future-window deferral and recontact auto campaigns", () => {
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "Follow-up future-window deferral notice (auto)",
      }),
      true
    );
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "Follow-up future-window recontact (auto)",
      }),
      true
    );
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "Follow-up future-window recontact (manual)",
      }),
      false
    );
  });

  it("rejects ad-hoc booking/manual campaigns", () => {
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "lead_scheduler_link",
      }),
      false
    );
    assert.equal(
      isEligibleFollowUpTaskDraftSource({
        campaignName: "call_requested",
      }),
      false
    );
  });
});
