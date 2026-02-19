import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { buildCrmWebhookSignature, isCrmWebhookRetryableStatus } from "@/lib/webhook-events/crm-outbound";

describe("crm outbound webhook processor helpers", () => {
  it("builds deterministic hmac-sha256 signatures", () => {
    const secret = "test-secret";
    const timestamp = "2026-02-19T00:00:00.000Z";
    const body = JSON.stringify({ hello: "world" });

    const expected = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex")}`;

    assert.equal(buildCrmWebhookSignature({ secret, timestamp, body }), expected);
  });

  it("classifies retryable HTTP statuses", () => {
    assert.equal(isCrmWebhookRetryableStatus(408), true);
    assert.equal(isCrmWebhookRetryableStatus(425), true);
    assert.equal(isCrmWebhookRetryableStatus(429), true);
    assert.equal(isCrmWebhookRetryableStatus(500), true);
    assert.equal(isCrmWebhookRetryableStatus(503), true);
    assert.equal(isCrmWebhookRetryableStatus(400), false);
    assert.equal(isCrmWebhookRetryableStatus(404), false);
  });
});
