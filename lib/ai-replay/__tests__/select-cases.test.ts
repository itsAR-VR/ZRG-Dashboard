import assert from "node:assert/strict";
import test from "node:test";

import { __private__, selectReplayCases } from "@/lib/ai-replay/select-cases";

type MockMessage = {
  id: string;
  channel: string;
  sentAt: Date;
  subject: string | null;
  body: string;
  lead: {
    id: string;
    clientId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    sentimentTag: string | null;
  };
};

function buildMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: "message-1",
    channel: "email",
    sentAt: new Date("2026-02-11T10:00:00.000Z"),
    subject: "Pricing",
    body: "Could you share monthly and annual pricing options?",
    lead: {
      id: "lead-1",
      clientId: "client-1",
      firstName: "Alex",
      lastName: "Lane",
      email: "alex@example.com",
      sentimentTag: "Information Requested",
    },
    ...overrides,
  };
}

function createDbStub(responses: MockMessage[][]): {
  calls: Record<string, unknown>[];
  dbClient: {
    message: {
      findMany: (args: Record<string, unknown>) => Promise<MockMessage[]>;
    };
  };
} {
  const calls: Record<string, unknown>[] = [];
  let index = 0;

  return {
    calls,
    dbClient: {
      message: {
        findMany: async (args: Record<string, unknown>) => {
          calls.push(args);
          const out = responses[index] ?? [];
          index += 1;
          return out;
        },
      },
    },
  };
}

test("computeRiskSignals prioritizes pricing and cadence language", () => {
  const result = __private__.computeRiskSignals({
    body: "We can do $3,000 monthly or $30,000 annual billed quarterly.",
    subject: "Pricing details",
    sentimentTag: "Information Requested",
    explicit: false,
  });

  assert.ok(result.score >= 120);
  assert.ok(result.reasons.includes("pricing_keyword"));
  assert.ok(result.reasons.includes("cadence_keyword"));
  assert.ok(result.reasons.includes("dollar_amount"));
  assert.ok(result.reasons.includes("information_requested"));
});

test("computeRiskSignals boosts explicit thread IDs", () => {
  const result = __private__.computeRiskSignals({
    body: "Can you send details?",
    subject: null,
    sentimentTag: "Follow Up",
    explicit: true,
  });

  assert.ok(result.reasons.includes("explicit_thread_id"));
  assert.ok(result.score >= 100);
});

test("normalizeChannel accepts known channels only", () => {
  assert.equal(__private__.normalizeChannel("email"), "email");
  assert.equal(__private__.normalizeChannel("sms"), "sms");
  assert.equal(__private__.normalizeChannel("linkedin"), "linkedin");
  assert.equal(__private__.normalizeChannel("unknown"), null);
});

test("selectReplayCases widens from requested channel to all channels in window", async () => {
  const smsMessage = buildMockMessage({
    id: "message-sms-1",
    channel: "sms",
    subject: null,
    body: "Text me details about annual plan billing cadence.",
  });
  const { calls, dbClient } = createDbStub([[], [smsMessage]]);
  const result = await selectReplayCases({
    clientId: "client-1",
    threadIds: [],
    channel: "email",
    from: new Date("2026-02-01T00:00:00.000Z"),
    to: new Date("2026-02-12T00:00:00.000Z"),
    limit: 20,
    dbClient,
  });

  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0]?.channel, "sms");
  assert.equal(calls.length, 2);
  assert.match(result.warnings.join(" | "), /widening to all channels in requested window/i);

  const firstWhere = calls[0]?.where as Record<string, unknown>;
  const secondWhere = calls[1]?.where as Record<string, unknown>;
  assert.equal(firstWhere.channel, "email");
  assert.equal("channel" in secondWhere, false);
  assert.equal("sentAt" in secondWhere, true);
});

test("selectReplayCases falls back to all-time search when requested window has no inbound", async () => {
  const oldMessage = buildMockMessage({
    id: "message-old-1",
    sentAt: new Date("2025-11-15T12:00:00.000Z"),
  });
  const { calls, dbClient } = createDbStub([[], [oldMessage]]);
  const result = await selectReplayCases({
    clientId: "client-1",
    threadIds: [],
    channel: "any",
    from: new Date("2026-02-01T00:00:00.000Z"),
    to: new Date("2026-02-12T00:00:00.000Z"),
    limit: 20,
    dbClient,
  });

  assert.equal(result.cases.length, 1);
  assert.equal(calls.length, 2);
  assert.match(result.warnings.join(" | "), /widening to all channels across full history/i);
  const secondWhere = calls[1]?.where as Record<string, unknown>;
  assert.equal("sentAt" in secondWhere, false);
});

test("selectReplayCases returns explicit no-data warning when nothing is available", async () => {
  const { calls, dbClient } = createDbStub([[], [], [], []]);
  const result = await selectReplayCases({
    clientId: "client-empty",
    threadIds: [],
    channel: "email",
    from: new Date("2026-02-01T00:00:00.000Z"),
    to: new Date("2026-02-12T00:00:00.000Z"),
    limit: 20,
    dbClient,
  });

  assert.equal(result.cases.length, 0);
  assert.equal(calls.length, 4);
  assert.match(result.warnings.join(" | "), /No inbound messages found for client client-empty/i);
});
