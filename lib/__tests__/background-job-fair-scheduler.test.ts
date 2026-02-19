import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFairWorkspaceQueue,
  claimNextQuotaEligibleJob,
  getBackgroundWorkspaceQuotaConfig,
  isBackgroundWorkspaceHighQuotaEligible,
  selectPartitionedWorkspaceJobs,
  resolveBackgroundWorkspaceQuota,
} from "../background-jobs/fair-scheduler";

describe("background job fair scheduler", () => {
  it("builds a round-robin queue by first-seen workspace order", () => {
    const queue = buildFairWorkspaceQueue([
      { id: "a1", clientId: "A" },
      { id: "a2", clientId: "A" },
      { id: "a3", clientId: "A" },
      { id: "b1", clientId: "B" },
      { id: "b2", clientId: "B" },
      { id: "c1", clientId: "C" },
    ]);

    assert.deepEqual(
      queue.map((job) => job.id),
      ["a1", "b1", "c1", "a2", "b2", "a3"]
    );
  });

  it("parses workspace quota config and legacy high-quota fallback ids", () => {
    const config = getBackgroundWorkspaceQuotaConfig({
      BACKGROUND_JOB_WORKSPACE_QUOTA_DEFAULT: "7",
      BACKGROUND_JOB_WORKSPACE_QUOTA_ENTERPRISE: "21",
      BACKGROUND_JOB_ENTERPRISE_CLIENT_IDS: "client-enterprise, client-vip ",
    });

    assert.equal(config.defaultQuota, 7);
    assert.equal(config.highQuota, 21);
    assert.equal(isBackgroundWorkspaceHighQuotaEligible("client-standard", false, config), false);
    assert.equal(isBackgroundWorkspaceHighQuotaEligible("client-enterprise", false, config), true);
    assert.equal(isBackgroundWorkspaceHighQuotaEligible("client-vip", false, config), true);
    assert.equal(isBackgroundWorkspaceHighQuotaEligible("client-standard", true, config), true);
    assert.equal(resolveBackgroundWorkspaceQuota(false, config), 7);
    assert.equal(resolveBackgroundWorkspaceQuota(true, config), 21);
  });

  it("claims the next quota-eligible job and skips quota-blocked workspace entries", () => {
    const queue = [
      { id: "a1", clientId: "A" },
      { id: "a2", clientId: "A" },
      { id: "b1", clientId: "B" },
    ];
    const activeByClient = new Map<string, number>([["A", 1]]);

    const first = claimNextQuotaEligibleJob(queue, activeByClient, (clientId) => (clientId === "A" ? 1 : 2));
    assert.equal(first?.id, "b1");
    assert.equal(activeByClient.get("B"), 1);

    const second = claimNextQuotaEligibleJob(queue, activeByClient, (clientId) => (clientId === "A" ? 1 : 2));
    assert.equal(second, null);

    activeByClient.delete("A");
    const third = claimNextQuotaEligibleJob(queue, activeByClient, () => 1);
    assert.equal(third?.id, "a1");
  });

  it("selects a partitioned due-job subset with per-workspace caps", () => {
    const selected = selectPartitionedWorkspaceJobs(
      [
        { id: "a1", clientId: "A" },
        { id: "a2", clientId: "A" },
        { id: "a3", clientId: "A" },
        { id: "b1", clientId: "B" },
        { id: "b2", clientId: "B" },
      ],
      4,
      2
    );

    assert.deepEqual(
      selected.map((job) => job.id),
      ["a1", "a2", "b1", "b2"]
    );
  });
});
