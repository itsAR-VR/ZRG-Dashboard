import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { stopEmailBisonCampaignFutureEmailsForLeads } from "../emailbison-api";

describe("stopEmailBisonCampaignFutureEmailsForLeads", () => {
  it("returns success=true when EmailBison responds with data.success=true", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify({ data: { success: true, message: "Stopping future emails." } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const result = await stopEmailBisonCampaignFutureEmailsForLeads("api-key", "14", [1], {
        baseHost: "send.meetinboxxia.com",
      });

      assert.equal(result.success, true);
      assert.equal(result.message, "Stopping future emails.");
      assert.equal(result.error, undefined);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("returns success=false when EmailBison returns an empty body", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      return new Response("", { status: 200 });
    });
    const warnMock = mock.method(console, "warn", () => undefined);

    try {
      const result = await stopEmailBisonCampaignFutureEmailsForLeads("api-key", "14", [1], {
        baseHost: "send.meetinboxxia.com",
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    } finally {
      fetchMock.mock.restore();
      warnMock.mock.restore();
    }
  });

  it("returns success=false when EmailBison response omits the success flag", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify({ data: { message: "Stopping future emails." } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const warnMock = mock.method(console, "warn", () => undefined);

    try {
      const result = await stopEmailBisonCampaignFutureEmailsForLeads("api-key", "14", [1], {
        baseHost: "send.meetinboxxia.com",
      });

      assert.equal(result.success, false);
      assert.ok(result.error);
    } finally {
      fetchMock.mock.restore();
      warnMock.mock.restore();
    }
  });
});
