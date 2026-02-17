import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectActionSignals,
  detectCallSignalHeuristic,
  detectExternalCalendarHeuristic,
  EMPTY_ACTION_SIGNAL_RESULT,
  shouldRunSignatureLinkDisambiguation,
  type ActionSignalDetectionResult,
  type BookingProcessRoute,
} from "../action-signal-detector";
import { buildActionSignalsPromptAppendix } from "../ai-drafts";

describe("action signal detector: heuristics", () => {
  it("returns high-confidence call signal for Call Requested sentiment", () => {
    const signal = detectCallSignalHeuristic("Thanks", "Call Requested");
    assert.equal(signal?.type, "call_requested");
    assert.equal(signal?.confidence, "high");
  });

  it("detects medium-confidence call keyword from stripped body", () => {
    const signal = detectCallSignalHeuristic("Can you call me tomorrow morning?", "Interested");
    assert.equal(signal?.type, "call_requested");
    assert.equal(signal?.confidence, "medium");
  });

  it("detects signature-style 'number below' call request phrasing", () => {
    const signal = detectCallSignalHeuristic("You may reach me at the direct contact number below.", "Interested");
    assert.equal(signal?.type, "call_requested");
    assert.equal(signal?.confidence, "medium");
  });

  it("does not treat plain phone signature text as a call request", () => {
    const signal = detectCallSignalHeuristic("Phone: 555-1234", "Interested");
    assert.equal(signal, null);
  });

  it("detects external scheduler link in body when not workspace link", () => {
    const signal = detectExternalCalendarHeuristic(
      "Please use my link: https://calendly.com/demo-user/30min",
      "https://myworkspace.com/book"
    );
    assert.equal(signal?.type, "book_on_external_calendar");
    assert.equal(signal?.confidence, "high");
  });

  it("ignores scheduler link when it matches workspace booking link", () => {
    const signal = detectExternalCalendarHeuristic(
      "Book here: https://calendly.com/team/demo/",
      "https://calendly.com/team/demo?utm_source=test"
    );
    assert.equal(signal, null);
  });

  it("detects external-calendar phrase without URL", () => {
    const signal = detectExternalCalendarHeuristic("Can you book on my calendar?", null);
    assert.equal(signal?.type, "book_on_external_calendar");
    assert.equal(signal?.confidence, "medium");
  });
});

describe("action signal detector: signature disambiguation trigger", () => {
  it("triggers only when link is in full text, missing from stripped text, and body has booking language", () => {
    const shouldRun = shouldRunSignatureLinkDisambiguation(
      "Please book a time that works for you.",
      "Please book a time that works for you.\\n\\n--\\nhttps://calendly.com/manager/demo"
    );
    assert.equal(shouldRun, true);
  });

  it("does not trigger when link is already in stripped text", () => {
    const shouldRun = shouldRunSignatureLinkDisambiguation(
      "Please use https://calendly.com/manager/demo to schedule.",
      "Please use https://calendly.com/manager/demo to schedule."
    );
    assert.equal(shouldRun, false);
  });

  it("does not trigger when body has no scheduling language", () => {
    const shouldRun = shouldRunSignatureLinkDisambiguation(
      "Thanks for the update.",
      "Thanks for the update.\\n\\n--\\nhttps://calendly.com/manager/demo"
    );
    assert.equal(shouldRun, false);
  });

  it("does not trigger for call-only wording with signature link", () => {
    const shouldRun = shouldRunSignatureLinkDisambiguation(
      "Can you call me later today?",
      "Can you call me later today?\\n\\n--\\nhttps://calendly.com/manager/demo"
    );
    assert.equal(shouldRun, false);
  });
});

describe("action signal detector: end-to-end detection", () => {
  it("gates out non-positive sentiment and skips disambiguation", async () => {
    let called = false;
    let routeCalled = false;
    const result = await detectActionSignals({
      strippedText: "book on my calendar",
      fullText: "book on my calendar",
      sentimentTag: "Not Interested",
      workspaceBookingLink: null,
      clientId: "client-1",
      leadId: "lead-1",
      disambiguate: async () => {
        called = true;
        return { intentional: true, evidence: "intentional" };
      },
      routeBookingProcess: async () => {
        routeCalled = true;
        return null;
      },
    });

    assert.deepEqual(result, EMPTY_ACTION_SIGNAL_RESULT);
    assert.equal(called, false);
    assert.equal(routeCalled, false);
  });

  it("returns both call and external-calendar signals from heuristics", async () => {
    const result = await detectActionSignals({
      strippedText: "Can you call me and book on my calendar?",
      fullText: "Can you call me and book on my calendar?",
      sentimentTag: "Interested",
      workspaceBookingLink: "https://myworkspace.com/book",
      clientId: "client-1",
      leadId: "lead-1",
      aiRouteBookingProcessEnabled: false,
    });

    assert.equal(result.hasCallSignal, true);
    assert.equal(result.hasExternalCalendarSignal, true);
    assert.equal(result.signals.length, 2);
  });

  it("uses injected disambiguator for ambiguous signature-link case", async () => {
    let called = false;
    const result = await detectActionSignals({
      strippedText: "Please book a time that works.",
      fullText: "Please book a time that works.\\n\\n--\\nhttps://calendly.com/manager/demo",
      sentimentTag: "Interested",
      workspaceBookingLink: null,
      clientId: "client-1",
      leadId: "lead-1",
      disambiguate: async () => {
        called = true;
        return { intentional: true, evidence: "explicit booking language" };
      },
      aiRouteBookingProcessEnabled: false,
    });

    assert.equal(called, true);
    assert.equal(result.hasExternalCalendarSignal, true);
    assert.ok(result.signals.some((signal) => signal.type === "book_on_external_calendar"));
  });

  it("does not call disambiguator when Tier 1 already found body link", async () => {
    let called = false;
    const result = await detectActionSignals({
      strippedText: "Please use https://calendly.com/manager/demo to book.",
      fullText: "Please use https://calendly.com/manager/demo to book.",
      sentimentTag: "Interested",
      workspaceBookingLink: "https://myworkspace.com/book",
      clientId: "client-1",
      leadId: "lead-1",
      disambiguate: async () => {
        called = true;
        return { intentional: true, evidence: "should not run" };
      },
      aiRouteBookingProcessEnabled: false,
    });

    assert.equal(called, false);
    assert.equal(result.hasExternalCalendarSignal, true);
  });
});

describe("action signal detector: booking process routing", () => {
  const processRoute = (processId: 1 | 2 | 3 | 4 | 5): BookingProcessRoute => ({
    processId,
    confidence: 0.91,
    rationale: `process-${processId}`,
    uncertain: false,
  });

  it("supports route-only outcomes for process 1 with no action signals", async () => {
    const result = await detectActionSignals({
      strippedText: "Can you share details before we schedule?",
      fullText: "Can you share details before we schedule?",
      sentimentTag: "Interested",
      workspaceBookingLink: "https://workspace.example/book",
      clientId: "client-1",
      leadId: "lead-1",
      routeBookingProcess: async () => processRoute(1),
      channel: "email",
      provider: "emailbison",
    });

    assert.equal(result.signals.length, 0);
    assert.equal(result.route?.processId, 1);
  });

  it("returns route metadata for process 4 alongside call signal", async () => {
    const result = await detectActionSignals({
      strippedText: "Can you call me tomorrow?",
      fullText: "Can you call me tomorrow?",
      sentimentTag: "Call Requested",
      workspaceBookingLink: null,
      clientId: "client-1",
      leadId: "lead-1",
      routeBookingProcess: async () => processRoute(4),
      channel: "sms",
      provider: "ghl",
    });

    assert.equal(result.hasCallSignal, true);
    assert.equal(result.route?.processId, 4);
  });

  it("returns route metadata for process 5 alongside external-calendar signal", async () => {
    const result = await detectActionSignals({
      strippedText: "Use my link https://calendly.com/demo-user/30min",
      fullText: "Use my link https://calendly.com/demo-user/30min",
      sentimentTag: "Interested",
      workspaceBookingLink: "https://workspace.example/book",
      clientId: "client-1",
      leadId: "lead-1",
      routeBookingProcess: async () => processRoute(5),
      channel: "linkedin",
      provider: "unipile",
    });

    assert.equal(result.hasExternalCalendarSignal, true);
    assert.equal(result.route?.processId, 5);
  });

  it("adds a call signal when the router routes to process 4 despite no heuristic hit", async () => {
    const result = await detectActionSignals({
      strippedText: "Thanks.",
      fullText: "Reach me at direct contact number below.\n\nPhone: 555-123-4567",
      sentimentTag: "Interested",
      workspaceBookingLink: null,
      clientId: "client-1",
      leadId: "lead-1",
      routeBookingProcess: async () => processRoute(4),
      channel: "email",
      provider: "emailbison",
    });

    const callSignal = result.signals.find((signal) => signal.type === "call_requested");
    assert.ok(callSignal, "call signal should be added from router outcome");
    assert.match(callSignal?.evidence ?? "", /booking process router/i);
    assert.equal(result.hasCallSignal, true);
    assert.equal(result.route?.processId, 4);
  });

  it("fails open when router throws and keeps signal detection", async () => {
    const result = await detectActionSignals({
      strippedText: "Can you call me?",
      fullText: "Can you call me?",
      sentimentTag: "Interested",
      workspaceBookingLink: null,
      clientId: "client-1",
      leadId: "lead-1",
      routeBookingProcess: async () => {
        throw new Error("timeout");
      },
      channel: "sms",
      provider: "ghl",
    });

    assert.equal(result.hasCallSignal, true);
    assert.equal(result.route, null);
  });

  it("skips routing when workspace toggle is disabled", async () => {
    let routeCalled = false;
    const result = await detectActionSignals({
      strippedText: "Please share availability",
      fullText: "Please share availability",
      sentimentTag: "Interested",
      workspaceBookingLink: "https://workspace.example/book",
      clientId: "client-1",
      leadId: "lead-1",
      aiRouteBookingProcessEnabled: false,
      routeBookingProcess: async () => {
        routeCalled = true;
        return processRoute(2);
      },
    });

    assert.equal(routeCalled, false);
    assert.equal(result.route, null);
  });
});

describe("action signal prompt appendix", () => {
  it("returns empty string when no signals are present", () => {
    assert.equal(buildActionSignalsPromptAppendix(null), "");
    assert.equal(buildActionSignalsPromptAppendix({ ...EMPTY_ACTION_SIGNAL_RESULT }), "");
  });

  it("includes call guidance for call signals", () => {
    const result: ActionSignalDetectionResult = {
      signals: [{ type: "call_requested", confidence: "high", evidence: "lead asked for call" }],
      hasCallSignal: true,
      hasExternalCalendarSignal: false,
      route: null,
    };

    const appendix = buildActionSignalsPromptAppendix(result);
    assert.match(appendix, /requested or implied they want a phone call/i);
    assert.match(appendix, /do not suggest email-only scheduling/i);
  });

  it("includes external-calendar guidance for external calendar signals", () => {
    const result: ActionSignalDetectionResult = {
      signals: [{ type: "book_on_external_calendar", confidence: "high", evidence: "provided calendar" }],
      hasCallSignal: false,
      hasExternalCalendarSignal: true,
      route: null,
    };

    const appendix = buildActionSignalsPromptAppendix(result);
    assert.match(appendix, /provided their own scheduling link/i);
    assert.match(appendix, /do not offer the workspace's default availability\/booking link/i);
  });

  it("includes both guidance blocks when both signals exist", () => {
    const result: ActionSignalDetectionResult = {
      signals: [
        { type: "call_requested", confidence: "high", evidence: "call" },
        { type: "book_on_external_calendar", confidence: "high", evidence: "calendar" },
      ],
      hasCallSignal: true,
      hasExternalCalendarSignal: true,
      route: null,
    };

    const appendix = buildActionSignalsPromptAppendix(result);
    assert.match(appendix, /phone call/i);
    assert.match(appendix, /default availability\/booking link/i);
  });

  it("includes process-specific route guidance for route-only process 2", () => {
    const appendix = buildActionSignalsPromptAppendix({
      ...EMPTY_ACTION_SIGNAL_RESULT,
      route: {
        processId: 2,
        confidence: 0.87,
        rationale: "Lead is replying to offered times",
        uncertain: false,
      },
    });

    assert.match(appendix, /process 2 guidance/i);
    assert.match(appendix, /booking process route: process 2/i);
  });

  it("includes process 4 call guidance when route exists without explicit call signal", () => {
    const appendix = buildActionSignalsPromptAppendix({
      ...EMPTY_ACTION_SIGNAL_RESULT,
      route: {
        processId: 4,
        confidence: 0.79,
        rationale: "Call-first language",
        uncertain: true,
      },
    });

    assert.match(appendix, /process 4 guidance/i);
    assert.match(appendix, /call-first intent/i);
  });
});
