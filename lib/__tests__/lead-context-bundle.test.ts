import assert from "node:assert/strict";
import test from "node:test";

import { PRIMARY_WEBSITE_ASSET_NAME } from "../knowledge-asset-context";
import { buildLeadContextBundle } from "../lead-context-bundle";

test("LeadContextBundle: draft profile returns unredacted memory", async () => {
  const bundle = await buildLeadContextBundle({
    clientId: "client_1",
    leadId: "lead_1",
    profile: "draft",
    timeoutMs: 50,
    settings: {
      clientId: "client_1",
      serviceDescription: null,
      aiGoals: null,
      leadContextBundleBudgets: null as any,
    },
    knowledgeAssets: [],
    memoryEntries: [
      {
        category: "Note",
        content: "Email me at test@example.com or call +1 (555) 123-4567.",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ],
  });

  assert.ok(bundle.leadMemoryContext?.includes("test@example.com"));
  assert.ok(bundle.leadMemoryContext?.includes("555"));
  assert.ok(!bundle.leadMemoryContext?.includes("[redacted-email]"));
});

test("LeadContextBundle: non-draft profiles redact memory", async () => {
  const bundle = await buildLeadContextBundle({
    clientId: "client_1",
    leadId: "lead_1",
    profile: "meeting_overseer_gate",
    timeoutMs: 50,
    settings: {
      clientId: "client_1",
      serviceDescription: null,
      aiGoals: null,
      leadContextBundleBudgets: null as any,
    },
    knowledgeAssets: [],
    memoryEntries: [
      {
        category: "Note",
        content: "Email me at test@example.com or call +1 (555) 123-4567.",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ],
  });

  assert.ok(bundle.leadMemoryContext?.includes("[redacted-email]"));
  assert.ok(bundle.leadMemoryContext?.includes("[redacted-phone]"));
  assert.ok(!bundle.leadMemoryContext?.includes("test@example.com"));
});

test("LeadContextBundle: excludes primary website asset from knowledgeContext", async () => {
  const bundle = await buildLeadContextBundle({
    clientId: "client_1",
    leadId: "lead_1",
    profile: "draft",
    timeoutMs: 50,
    settings: {
      clientId: "client_1",
      serviceDescription: null,
      aiGoals: null,
      leadContextBundleBudgets: {
        draft: {
          // Keep memory disabled for this test so it stays pure.
          memory: { maxTokens: 0, maxEntryTokens: 0 },
        },
      } as any,
    },
    knowledgeAssets: [
      {
        name: PRIMARY_WEBSITE_ASSET_NAME,
        type: "url",
        fileUrl: "https://example.com",
        textContent: "https://example.com",
        originalFileName: null,
        mimeType: null,
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        name: "Pricing",
        type: "text",
        fileUrl: null,
        textContent: "We charge $1000/month.",
        originalFileName: null,
        mimeType: null,
        updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      },
    ],
    memoryEntries: [],
  });

  assert.equal(bundle.primaryWebsiteUrl, "https://example.com");
  assert.ok(bundle.knowledgeContext?.includes("[Pricing]"));
  assert.ok(!bundle.knowledgeContext?.includes(PRIMARY_WEBSITE_ASSET_NAME));
});

test("LeadContextBundle: respects per-profile budget overrides", async () => {
  const bundle = await buildLeadContextBundle({
    clientId: "client_1",
    leadId: "lead_1",
    profile: "draft",
    timeoutMs: 50,
    settings: {
      clientId: "client_1",
      serviceDescription: null,
      aiGoals: null,
      leadContextBundleBudgets: {
        draft: {
          knowledge: { maxTokens: 123, maxAssetTokens: 7 },
          memory: { maxTokens: 45, maxEntryTokens: 6 },
        },
      } as any,
    },
    knowledgeAssets: [
      {
        name: "A",
        type: "text",
        fileUrl: null,
        textContent: "Hello world",
        originalFileName: null,
        mimeType: null,
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ],
    memoryEntries: [
      {
        category: "Note",
        content: "A short note.",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ],
  });

  assert.equal(bundle.stats.knowledge?.maxTokens, 123);
  assert.equal(bundle.stats.knowledge?.maxAssetTokens, 7);
  assert.equal(bundle.stats.memory?.maxTokens, 45);
  assert.equal(bundle.stats.memory?.maxEntryTokens, 6);
});

