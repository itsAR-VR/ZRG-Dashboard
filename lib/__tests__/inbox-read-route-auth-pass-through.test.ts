import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("inbox read-route auth pass-through", () => {
  it("passes route-authenticated user context into inbox actions", () => {
    const countsRoute = read("app/api/inbox/counts/route.ts");
    assert.match(
      countsRoute,
      /getInboxCounts\(clientId, \{ authUser, throwOnAuthError: true \}\)/,
      "expected inbox counts route to pass authUser and enforce auth-error propagation"
    );

    const conversationsRoute = read("app/api/inbox/conversations/route.ts");
    assert.match(
      conversationsRoute,
      /getConversationsCursor\(\{ \.\.\.options, authUser \}\)/,
      "expected conversations route to pass authUser"
    );

    const singleConversationRoute = read("app/api/inbox/conversations/[leadId]/route.ts");
    assert.match(
      singleConversationRoute,
      /getConversation\(leadId, channelFilter, \{ authUser \}\)/,
      "expected conversation detail route to pass authUser"
    );
  });

  it("allows inbox actions to reuse route-authenticated users", () => {
    const leadActions = read("actions/lead-actions.ts");

    assert.match(
      leadActions,
      /resolveInboxScope\(clientId, opts\?\.authUser\)/,
      "expected getInboxCounts to resolve scope from optional authUser"
    );
    assert.match(
      leadActions,
      /const scope = await resolveInboxScope\(clientId, authUser\);/,
      "expected cursor/from-end inbox actions to use optional authUser scope"
    );
    assert.match(
      leadActions,
      /if \(opts\?\.throwOnAuthError\) \{/,
      "expected inbox counts to support strict auth error propagation for read APIs"
    );
  });
});
