import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractTimezoneFromConversation } from "../timezone-inference";

describe("extractTimezoneFromConversation", () => {
  it("extracts timezone abbreviation tied to scheduling text", async () => {
    const result = await extractTimezoneFromConversation({
      messageText: "I'm free before noon PST next week.",
      clientId: "client-test",
      leadId: "lead-test",
    });

    assert.equal(result?.timezone, "America/Los_Angeles");
    assert.equal(result?.source, "regex");
  });

  it("extracts explicit IANA timezone mention", async () => {
    const result = await extractTimezoneFromConversation({
      messageText: "Let's do 10:00 in America/New_York.",
      clientId: "client-test",
      leadId: "lead-test",
    });

    assert.equal(result?.timezone, "America/New_York");
    assert.equal(result?.source, "regex");
  });

  it("extracts city/location hint without requiring AI", async () => {
    const result = await extractTimezoneFromConversation({
      messageText: "I'm mostly in Miami now.",
      clientId: "client-test",
      leadId: "lead-test",
    });

    assert.equal(result?.timezone, "America/New_York");
    assert.equal(result?.source, "regex");
  });

  it("returns null when no regex signal is present and AI is disabled", async () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const result = await extractTimezoneFromConversation({
        messageText: "I have a question about your offer.",
        clientId: "client-test",
        leadId: "lead-test",
      });

      assert.equal(result, null);
    } finally {
      if (previousApiKey) {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });
});
