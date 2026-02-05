import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAllowedAdminSecrets, getProvidedAdminSecret, verifyAdminActionSecret } from "@/lib/admin-actions-auth";

describe("admin actions auth helper", () => {
  it("filters empty secrets", () => {
    const allowed = getAllowedAdminSecrets({
      ADMIN_ACTIONS_SECRET: "  ",
      WORKSPACE_PROVISIONING_SECRET: "secret",
    });

    assert.deepEqual(allowed, ["secret"]);
  });

  it("returns 500 when no admin secrets configured", () => {
    const headers = new Headers();
    const result = verifyAdminActionSecret({ headers, env: {} });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 500);
  });

  it("accepts Bearer admin secret", () => {
    const headers = new Headers({ authorization: "Bearer admin-secret" });
    const result = verifyAdminActionSecret({
      headers,
      env: { ADMIN_ACTIONS_SECRET: "admin-secret" },
    });
    assert.equal(result.ok, true);
  });

  it("accepts workspace provisioning secret header", () => {
    const headers = new Headers({ "x-workspace-provisioning-secret": "workspace-secret" });
    const result = verifyAdminActionSecret({
      headers,
      env: { WORKSPACE_PROVISIONING_SECRET: "workspace-secret" },
    });
    assert.equal(result.ok, true);
  });

  it("does not accept cron secret header", () => {
    const headers = new Headers({ "x-cron-secret": "cron-secret" });
    const provided = getProvidedAdminSecret(headers);
    assert.equal(provided, null);
  });
});
