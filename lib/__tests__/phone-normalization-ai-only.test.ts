import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePhoneE164ForSmsSendAiOnly } from "@/lib/phone-normalization";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";

describe("resolvePhoneE164ForSmsSendAiOnly", () => {
  it("returns missing_phone when phone is empty", async () => {
    const result = await resolvePhoneE164ForSmsSendAiOnly({
      clientId: "client-1",
      leadId: "lead-1",
      phone: null,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing_phone");
  });

  it("accepts valid E.164 returned by AI", async () => {
    const runPrompt = (async () =>
      ({
        success: true,
        data: { e164: "+14155552671", reason: "ai_no_answer" },
      }) as any) as typeof runStructuredJsonPrompt;

    const result = await resolvePhoneE164ForSmsSendAiOnly(
      {
        clientId: "client-1",
        leadId: "lead-1",
        phone: "(415) 555-2671",
      },
      { runPrompt }
    );

    assert.equal(result.ok, true);
    assert.equal(result.e164, "+14155552671");
  });

  it("rejects invalid E.164 returned by AI", async () => {
    const runPrompt = (async () =>
      ({
        success: true,
        data: { e164: "+123", reason: "ai_no_answer" },
      }) as any) as typeof runStructuredJsonPrompt;

    const result = await resolvePhoneE164ForSmsSendAiOnly(
      {
        clientId: "client-1",
        leadId: "lead-1",
        phone: "4155552671",
      },
      { runPrompt }
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "ai_invalid_e164");
  });

  it("maps prompt-runner failure to ai_call_failed", async () => {
    const runPrompt = (async () =>
      ({
        success: false,
        error: { category: "api_error", message: "boom", retryable: true },
      }) as any) as typeof runStructuredJsonPrompt;

    const result = await resolvePhoneE164ForSmsSendAiOnly(
      {
        clientId: "client-1",
        leadId: "lead-1",
        phone: "4155552671",
      },
      { runPrompt }
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "ai_call_failed");
  });
});
