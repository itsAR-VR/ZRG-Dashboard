import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import { verifyRouteSecret } from "@/lib/api-secret-auth";

function makeRequest(url: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, { headers });
}

describe("verifyRouteSecret", () => {
  it("returns 500 when secret is not configured", () => {
    const result = verifyRouteSecret({
      request: makeRequest("https://example.test/api/foo"),
      expectedSecret: null,
      misconfiguredError: "missing secret",
    });

    assert.deepEqual(result, { ok: false, status: 500, error: "missing secret" });
  });

  it("accepts bearer token auth", () => {
    const result = verifyRouteSecret({
      request: makeRequest("https://example.test/api/foo", {
        authorization: "Bearer top-secret",
      }),
      expectedSecret: "top-secret",
    });

    assert.deepEqual(result, { ok: true });
  });

  it("accepts configured header auth", () => {
    const result = verifyRouteSecret({
      request: makeRequest("https://example.test/api/foo", {
        "x-admin-secret": "top-secret",
      }),
      expectedSecret: "top-secret",
    });

    assert.deepEqual(result, { ok: true });
  });

  it("supports query-string fallback when enabled", () => {
    const result = verifyRouteSecret({
      request: makeRequest("https://example.test/api/foo?secret=top-secret"),
      expectedSecret: "top-secret",
      allowQuerySecret: true,
    });

    assert.deepEqual(result, { ok: true });
  });

  it("rejects query-string fallback when disabled", () => {
    const result = verifyRouteSecret({
      request: makeRequest("https://example.test/api/foo?secret=top-secret"),
      expectedSecret: "top-secret",
    });

    assert.deepEqual(result, { ok: false, status: 401, error: "Unauthorized" });
  });
});
