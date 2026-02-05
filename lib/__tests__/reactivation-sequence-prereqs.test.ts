import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMissingReactivationPrereqs, getMissingReactivationPrereqs } from "@/lib/reactivation-sequence-prereqs";

describe("reactivation sequence prerequisites", () => {
  it("returns no missing prerequisites for email-only sequences", () => {
    const missing = getMissingReactivationPrereqs({
      channels: ["email"],
      lead: {},
      client: {},
    });

    assert.deepEqual(missing, []);
  });

  it("requires phone + GHL credentials for SMS", () => {
    const missing = getMissingReactivationPrereqs({
      channels: ["sms"],
      lead: { phone: null },
      client: { ghlPrivateKey: null, ghlLocationId: null },
    });

    assert.ok(missing.includes("lead.phone"));
    assert.ok(missing.includes("client.ghlPrivateKey"));
    assert.ok(missing.includes("client.ghlLocationId"));
  });

  it("requires LinkedIn URL + Unipile for LinkedIn steps", () => {
    const missing = getMissingReactivationPrereqs({
      channels: ["linkedin"],
      lead: { linkedinUrl: null },
      client: { unipileAccountId: null },
    });

    assert.ok(missing.includes("lead.linkedinUrl"));
    assert.ok(missing.includes("client.unipileAccountId"));
  });

  it("formats missing prerequisites for display", () => {
    const reason = formatMissingReactivationPrereqs(["lead.phone", "client.ghlLocationId"]);

    assert.equal(reason, "Missing follow-up prerequisites: lead phone, GHL location ID");
  });
});
