import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectDraftChannelsFromInboundHistory } from "../manual-draft-generation";

describe("collectDraftChannelsFromInboundHistory", () => {
  it("returns known draft channels in stable order", () => {
    const channels = collectDraftChannelsFromInboundHistory([
      "linkedin",
      "sms",
      "email",
      "sms",
      "ai_voice",
    ]);

    assert.deepEqual(channels, ["sms", "email", "linkedin"]);
  });

  it("filters unsupported channels", () => {
    const channels = collectDraftChannelsFromInboundHistory(["email", "unknown", "voice"]);
    assert.deepEqual(channels, ["email"]);
  });
});
