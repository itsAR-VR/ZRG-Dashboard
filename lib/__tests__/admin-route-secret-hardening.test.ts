import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("admin route secret hardening", () => {
  it("uses shared route-secret verification for workspace provisioning routes", () => {
    const workspacesRoute = read("app/api/admin/workspaces/route.ts");
    assert.match(workspacesRoute, /import \{ verifyRouteSecret \} from "@\/lib\/api-secret-auth";/);
    assert.match(workspacesRoute, /const auth = verifyRouteSecret\(/);

    const bootstrapRoute = read("app/api/admin/workspaces/bootstrap/route.ts");
    assert.match(bootstrapRoute, /import \{ verifyRouteSecret \} from "@\/lib\/api-secret-auth";/);
    assert.match(bootstrapRoute, /const auth = verifyRouteSecret\(/);

    const membersRoute = read("app/api/admin/workspaces/members/route.ts");
    assert.match(membersRoute, /import \{ verifyRouteSecret \} from "@\/lib\/api-secret-auth";/);
    assert.match(membersRoute, /const auth = verifyRouteSecret\(/);
  });

  it("requires admin secret for GHL webhook test endpoint", () => {
    const ghlTestRoute = read("app/api/webhooks/ghl/test/route.ts");
    assert.match(ghlTestRoute, /function requireWebhookTestAuth\(/);
    assert.match(ghlTestRoute, /verifyRouteSecret\(/);
    assert.match(ghlTestRoute, /const authResponse = requireWebhookTestAuth\(request\);/);
  });
});
