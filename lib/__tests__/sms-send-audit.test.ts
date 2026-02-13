import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applySmsBlockedAudit, applySmsSuccessAudit, isSmsSendBlocked } from "@/lib/sms-send-audit";

describe("sms-send-audit", () => {
  it("increments consecutive blocked count on each blocked send", () => {
    const first = applySmsBlockedAudit(
      {
        smsLastBlockedAt: null,
        smsLastBlockedReason: null,
        smsConsecutiveBlockedCount: 0,
        smsLastSuccessAt: null,
      },
      { reason: "missing phone" }
    );
    const second = applySmsBlockedAudit(first, { reason: "ai normalization failed" });

    assert.equal(first.smsConsecutiveBlockedCount, 1);
    assert.equal(second.smsConsecutiveBlockedCount, 2);
    assert.equal(second.smsLastBlockedReason, "ai normalization failed");
  });

  it("resets blocked counter and reason after a successful send", () => {
    const blocked = applySmsBlockedAudit(
      {
        smsLastBlockedAt: null,
        smsLastBlockedReason: null,
        smsConsecutiveBlockedCount: 2,
        smsLastSuccessAt: null,
      },
      { reason: "missing phone" }
    );
    const success = applySmsSuccessAudit(blocked);

    assert.equal(success.smsConsecutiveBlockedCount, 0);
    assert.equal(success.smsLastBlockedReason, null);
    assert.ok(success.smsLastSuccessAt instanceof Date);
  });

  it("shows blocked banner only when latest blocked timestamp is newer than success timestamp", () => {
    const blockedAt = new Date("2026-02-13T10:00:00.000Z");
    const successAt = new Date("2026-02-13T09:00:00.000Z");

    assert.equal(
      isSmsSendBlocked({
        smsLastBlockedAt: blockedAt,
        smsLastSuccessAt: successAt,
      }),
      true
    );

    assert.equal(
      isSmsSendBlocked({
        smsLastBlockedAt: blockedAt,
        smsLastSuccessAt: new Date("2026-02-13T11:00:00.000Z"),
      }),
      false
    );
  });
});
