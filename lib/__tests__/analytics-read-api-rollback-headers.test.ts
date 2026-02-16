import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextResponse } from "next/server";

import {
  attachReadApiHeaders,
  mapAnalyticsErrorToStatus,
  readApiDisabledResponse,
  resolveRequestId,
} from "@/app/api/analytics/_helpers";

describe("analytics read API rollback controls", () => {
  it("maps auth errors to explicit HTTP statuses", () => {
    assert.equal(mapAnalyticsErrorToStatus("Not authenticated"), 401);
    assert.equal(mapAnalyticsErrorToStatus("Unauthorized"), 403);
    assert.equal(mapAnalyticsErrorToStatus("anything else"), 500);
  });

  it("returns deterministic disabled response headers", () => {
    const response = readApiDisabledResponse({
      endpoint: "overview",
      requestId: "phase157-rollback-check",
      clientId: "workspace-123",
    });

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-zrg-read-api-enabled"), "0");
    assert.equal(response.headers.get("x-zrg-read-api-reason"), "disabled_by_flag");
    assert.equal(response.headers.get("x-request-id"), "phase157-rollback-check");
  });

  it("attaches enabled read-api headers on success responses", () => {
    const response = NextResponse.json({ success: true }, { status: 200 });
    const withHeaders = attachReadApiHeaders(response, {
      cacheControl: "private, max-age=60",
      requestId: "phase157-enabled-check",
    });

    assert.equal(withHeaders.headers.get("x-zrg-read-api-enabled"), "1");
    assert.equal(withHeaders.headers.get("x-request-id"), "phase157-enabled-check");
    assert.equal(withHeaders.headers.get("cache-control"), "private, max-age=60");
  });

  it("normalizes empty request IDs into valid generated IDs", () => {
    const requestId = resolveRequestId("   ");
    assert.ok(requestId.length > 0);
    assert.ok(requestId.length <= 128);
  });
});
