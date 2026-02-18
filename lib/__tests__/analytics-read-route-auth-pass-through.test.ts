import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("analytics read-route auth pass-through", () => {
  it("passes authenticated user context from read routes into analytics actions", () => {
    const overviewRoute = read("app/api/analytics/overview/route.ts");
    assert.match(
      overviewRoute,
      /getAnalytics\([\s\S]*authUser[\s,}]/,
      "expected overview route to pass authUser into getAnalytics"
    );

    const workflowsRoute = read("app/api/analytics/workflows/route.ts");
    assert.match(
      workflowsRoute,
      /getWorkflowAttributionAnalytics\([\s\S]*authUser[\s,}]/,
      "expected workflows route to pass authUser into getWorkflowAttributionAnalytics"
    );

    const campaignsRoute = read("app/api/analytics/campaigns/route.ts");
    assert.match(
      campaignsRoute,
      /const params = \{[\s\S]*authUser[\s,}]/,
      "expected campaigns route params to include authUser"
    );

    const crmRowsRoute = read("app/api/analytics/crm/rows/route.ts");
    assert.match(
      crmRowsRoute,
      /getCrmWindowSummary\(\{[\s\S]*authUser[\s,}]/,
      "expected CRM summary route call to pass authUser"
    );
    assert.match(
      crmRowsRoute,
      /getCrmSheetRows\(\{[\s\S]*authUser[\s,}]/,
      "expected CRM rows route call to pass authUser"
    );

    const responseTimingRoute = read("app/api/analytics/response-timing/route.ts");
    assert.match(
      responseTimingRoute,
      /getResponseTimingAnalytics\(\{[\s\S]*authUser[\s,}]/,
      "expected response-timing route to pass authUser"
    );
  });

  it("allows analytics actions to reuse route-authenticated users instead of re-authenticating", () => {
    const analyticsActions = read("actions/analytics-actions.ts");
    assert.match(
      analyticsActions,
      /const user = opts\?\.authUser \?\? \(await requireAuthUser\(\)\);/,
      "expected analytics actions to support authUser pass-through"
    );
    assert.match(
      analyticsActions,
      /const user = params\.authUser \?\? \(await requireAuthUser\(\)\);/,
      "expected CRM analytics actions to support authUser pass-through"
    );

    const responseTimingActions = read("actions/response-timing-analytics-actions.ts");
    assert.match(
      responseTimingActions,
      /resolveResponseTimingScope\(opts\?\.clientId \?\? null, opts\?\.authUser\)/,
      "expected response timing analytics to accept authUser pass-through"
    );
  });
});
