import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  cancelCalendlyScheduledEvent,
  createCalendlyInvitee,
  getCalendlyEventType,
} from "../calendly-api";

const ORIGINAL_FETCH = globalThis.fetch;

describe("calendly-api", () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("POST /invitees includes questions_and_answers with position", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(
        JSON.stringify({
          resource: {
            uri: "https://api.calendly.com/invitees/inv-1",
            scheduled_event: { uri: "https://api.calendly.com/scheduled_events/evt-1" },
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const res = await createCalendlyInvitee("token-123", {
      eventTypeUri: "https://api.calendly.com/event_types/evt-type-1",
      startTimeIso: "2026-01-01T00:00:00.000Z",
      invitee: { email: "test@example.com", name: "Test User", timezone: "America/New_York" },
      questionsAndAnswers: [{ question: "Company Name", answer: "Acme", position: 1 }],
    });

    assert.equal(res.success, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.url.includes("/invitees"));

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body.questions_and_answers, [{ question: "Company Name", answer: "Acme", position: 1 }]);
  });

  it("POST /invitees omits questions_and_answers when empty/invalid", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(
        JSON.stringify({
          resource: {
            uri: "https://api.calendly.com/invitees/inv-1",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const res = await createCalendlyInvitee("token-123", {
      eventTypeUri: "https://api.calendly.com/event_types/evt-type-1",
      startTimeIso: "2026-01-01T00:00:00.000Z",
      invitee: { email: "test@example.com", name: "Test User" },
      questionsAndAnswers: [
        { question: " ", answer: "Acme", position: 0 },
        { question: "Company Name", answer: " ", position: 0 },
      ],
    });

    assert.equal(res.success, true);
    assert.equal(calls.length, 1);

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal("questions_and_answers" in body, false);
  });

  it("GET event type parses custom_questions with name + position", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          resource: {
            uri: "https://api.calendly.com/event_types/evt-type-1",
            name: "Founders Club",
            scheduling_url: "https://calendly.com/acme/founders",
            custom_questions: [
              { name: "Company Name", position: 0, required: true, enabled: true, type: "string" },
              { name: "What would you like to discuss?", position: 1, required: true, enabled: true, type: "text" },
              { name: "", position: 2 },
              { position: 3 },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const res = await getCalendlyEventType("token-123", "https://api.calendly.com/event_types/evt-type-1");
    assert.equal(res.success, true);
    if (!res.success) return;

    assert.equal(res.data.uri, "https://api.calendly.com/event_types/evt-type-1");
    assert.equal(res.data.custom_questions.length, 2);
    assert.deepEqual(res.data.custom_questions[0], {
      name: "Company Name",
      type: "string",
      position: 0,
      enabled: true,
      required: true,
    });
  });

  it("POST scheduled event cancellation endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];

    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(
        JSON.stringify({
          resource: {
            uri: "https://api.calendly.com/scheduled_events/evt-1/cancellation",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const result = await cancelCalendlyScheduledEvent(
      "token-123",
      "https://api.calendly.com/scheduled_events/evt-1",
      { reason: "Not qualified" }
    );

    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.url.endsWith("/scheduled_events/evt-1/cancellation"));
    assert.equal(calls[0]!.init.method, "POST");

    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.reason, "Not qualified");
  });
});
