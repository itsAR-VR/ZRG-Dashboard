import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBookingOnlyConcisionGuard,
  applyClarifyOnlyThatDayDisambiguationGuard,
  applyClarifyOnlyWindowStartTimeGuard,
  applyContactUpdateNoSchedulingGuard,
  applyInfoThenBookingNoTimeRequestGuard,
  applyInfoThenBookingNoQualificationGatingGuard,
  applyInfoThenBookingNoQualificationQuestionGuard,
  applyMissingBookingLinkForCallCue,
  applyNeedsClarificationSingleQuestionGuard,
  applyRelativeWeekdayDateDisambiguationGuard,
  applySchedulingConfirmationWordingGuard,
  applyShouldBookNowConfirmationIfNeeded,
  applyTimezoneQuestionSuppressionGuard,
} from "../ai-drafts";
import type { MeetingOverseerExtractDecision } from "../meeting-overseer";
import { FOUNDERS_CLUB_CLIENT_ID } from "../workspace-policy-profile";

function buildExtraction(overrides?: Partial<MeetingOverseerExtractDecision>): MeetingOverseerExtractDecision {
  return {
    is_scheduling_related: true,
    intent: "propose_time",
    intent_to_book: true,
    intent_confidence: 0.8,
    acceptance_specificity: "day_only",
    accepted_slot_index: null,
    preferred_day_of_week: "tue",
    preferred_time_of_day: null,
    relative_preference: null,
    relative_preference_detail: null,
    qualification_status: "unknown",
    qualification_confidence: 0.6,
    qualification_evidence: [],
    time_from_body_only: true,
    detected_timezone: "America/Los_Angeles",
    time_extraction_confidence: 0.7,
    needs_clarification: true,
    clarification_reason: "needs_start_time",
    needs_pricing_answer: false,
    needs_community_details: false,
    confidence: 0.8,
    evidence: [],
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "yes",
      shouldBookNow: "no",
      leadTimezone: "America/Los_Angeles",
      leadProposedWindows: [{ type: "day_only", value: "tue", detail: null }],
      needsPricingAnswer: "no",
      needsCommunityDetails: "no",
      responseMode: "clarify_only",
      evidence: [],
    },
    decision_contract_status: "ok",
    decision_contract_error: null,
    ...overrides,
  };
}

test("applyTimezoneQuestionSuppressionGuard removes standalone timezone question when timezone is known", () => {
  const input = ["Hi Dan,", "", "Got it. What time zone should we book in?", "", "Best,", "Chris"].join("\n");
  const result = applyTimezoneQuestionSuppressionGuard({
    draft: input,
    extraction: buildExtraction({
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        leadTimezone: "America/Chicago",
      },
      detected_timezone: "America/Chicago",
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/time\s*zone/i.test(result.draft));
});

test("applyTimezoneQuestionSuppressionGuard removes inline timezone add-on inside a broader question", () => {
  const input = [
    "Hi Cellene,",
    "",
    "What time on Tuesday works best for a quick chat (and what timezone should we use)?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyTimezoneQuestionSuppressionGuard({
    draft: input,
    extraction: buildExtraction({
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        leadTimezone: "America/Los_Angeles",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.match(result.draft, /What time on Tuesday works best/i);
  assert.ok(!/timezone should we use/i.test(result.draft));
});

test("applyNeedsClarificationSingleQuestionGuard removes a compound OR clause inside a single question", () => {
  const input = [
    "Hi Dave,",
    "",
    "Was this intended for us, or was it sent to you by mistake? It looks unrelated to our thread, and we don't open unknown document links.",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyNeedsClarificationSingleQuestionGuard({
    draft: input,
    extraction: buildExtraction({
      needs_clarification: false,
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        hasBookingIntent: "no",
        responseMode: "info_then_booking",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/\bor\s+was\b/i.test(result.draft));
  assert.match(result.draft, /Was this intended for us\\?/i);
  assert.match(result.draft, /don't open unknown document links/i);
});

test("applyNeedsClarificationSingleQuestionGuard does not modify scheduling option questions", () => {
  const input = [
    "Hi Blair,",
    "",
    "What specific start time works for you on Thursday (12-3pm ET) or Friday (after 2pm ET)?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyNeedsClarificationSingleQuestionGuard({
    draft: input,
    extraction: buildExtraction(),
  });

  assert.equal(result.changed, false);
});

test("applyNeedsClarificationSingleQuestionGuard trims trailing parenthetical OR clauses", () => {
  const input = [
    "Hi Brandon,",
    "",
    "Have you sold a business for $2.5m+ or raised $2.5m+ in funding (or is there a target date you expect to cross $1m)?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyNeedsClarificationSingleQuestionGuard({
    draft: input,
    extraction: buildExtraction(),
  });

  assert.equal(result.changed, true);
  assert.ok(!/\bor\\s+is\\s+there\\s+a\\s+target\\s+date\\b/i.test(result.draft));
  assert.ok(result.draft.includes("Have you sold a business for $2.5m+ or raised $2.5m+ in funding?"));
});

test("applySchedulingConfirmationWordingGuard rewrites 'Locked for' to 'Confirmed for'", () => {
  const input = ["Hi Danny,", "", "Locked for Tue, Feb 17 at 10:00 AM PST.", "", "Best,", "Chris"].join("\n");
  const result = applySchedulingConfirmationWordingGuard({ draft: input });

  assert.equal(result.changed, true);
  assert.ok(!/\blocked for\b/i.test(result.draft));
  assert.ok(/\bConfirmed for\b/.test(result.draft));
});

test("applyRelativeWeekdayDateDisambiguationGuard restores 'next Monday' phrasing when the draft drops next", () => {
  const input = ["Hi Bill,", "", "What start time Monday afternoon (ET) should we use for a quick 15-minute call?", "", "Best,", "Chris"].join("\n");
  const result = applyRelativeWeekdayDateDisambiguationGuard({
    draft: input,
    extraction: buildExtraction({
      needs_clarification: true,
      relative_preference_detail: "next Monday afternoon",
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        leadProposedWindows: [
          { type: "day_only", value: "mon", detail: null },
          { type: "time_of_day", value: "afternoon", detail: null },
          { type: "relative", value: "after_date", detail: "next Monday afternoon" },
        ],
        responseMode: "clarify_only",
      },
    }),
    timeZone: "America/New_York",
    referenceDate: new Date("2026-02-13T21:37:10.000Z"),
  });

  assert.equal(result.changed, true);
  assert.match(result.draft, /\bnext\s+monday\b/i);
});

test("applyRelativeWeekdayDateDisambiguationGuard collapses 'Monday ... works' + generic start-time question", () => {
  const input = ["Hi Bill,", "", "Monday afternoon ET works. What start time should we use?", "", "Best,", "Chris"].join("\n");
  const result = applyRelativeWeekdayDateDisambiguationGuard({
    draft: input,
    extraction: buildExtraction({
      needs_clarification: true,
      relative_preference_detail: "next Monday afternoon",
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        leadProposedWindows: [
          { type: "day_only", value: "mon", detail: null },
          { type: "time_of_day", value: "afternoon", detail: null },
          { type: "relative", value: "after_date", detail: "next Monday afternoon" },
        ],
        responseMode: "clarify_only",
      },
    }),
    timeZone: "America/New_York",
    referenceDate: new Date("2026-02-13T21:37:10.000Z"),
  });

  assert.equal(result.changed, true);
  assert.match(result.draft, /\bWhat start time next Monday afternoon ET\b/i);
  assert.ok(!/\bworks\b/i.test(result.draft));
});

test("applyBookingOnlyConcisionGuard rewrites booking_only replies to be confirmation-forward and concise", () => {
  const input = [
    "Hi Danny,",
    "",
    "Tue, Feb 17 at 10:00 AM PST works.",
    "",
    "The membership fee is $9,500 per year. It works out to $791 per month for founders who want to explore before committing annually.",
    "",
    "On local founders: we generally keep the member roster private, but on the call we can share a feel for who’s in the Vancouver circle (roles, stage, and types of companies).",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyBookingOnlyConcisionGuard({
    draft: input,
    channel: "email",
    extraction: buildExtraction({
      needs_clarification: false,
      needs_pricing_answer: true,
      needs_community_details: true,
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        isQualified: "yes",
        hasBookingIntent: "yes",
        shouldBookNow: "yes",
        needsPricingAnswer: "yes",
        needsCommunityDetails: "yes",
        responseMode: "booking_only",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(/\bConfirmed for Tue,\s+Feb\s+17\b/.test(result.draft));
  assert.ok(!/\bworks\.\b/i.test(result.draft));
  assert.ok(!/before committing annually/i.test(result.draft));
  assert.ok(!/^On local founders:/im.test(result.draft));
  assert.ok(!/[()]/.test(result.draft));
});

test("applyClarifyOnlyThatDayDisambiguationGuard rewrites 'that day' to 'on that <weekday>'", () => {
  const input = ["Hi Ari,", "", "Yes, we can do the following Friday. What start time works for you that day?", "", "Best,", "Chris"].join("\n");

  const result = applyClarifyOnlyThatDayDisambiguationGuard({
    draft: input,
    extraction: buildExtraction({
      needs_clarification: true,
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        responseMode: "clarify_only",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/\bthat\s+day\b/i.test(result.draft));
  assert.match(result.draft, /\bon that Friday\b/i);
});

test("applyMissingBookingLinkForCallCue does not inject booking link in clarify_only mode", () => {
  const bookingLink = "https://calendly.com/d/cx6g-rr7-zkd/intro-call-with-fc";
  const input = ["Hi Blair,", "", "What start time works for a quick 15-minute chat?", "", "Best,", "Chris"].join("\n");

  const result = applyMissingBookingLinkForCallCue({
    draft: input,
    bookingLink,
    leadSchedulerLink: null,
    extraction: buildExtraction({
      needs_clarification: true,
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        responseMode: "clarify_only",
      },
    }),
  });

  assert.equal(result.changed, false);
  assert.ok(!result.draft.includes(bookingLink));
});

test("applyMissingBookingLinkForCallCue injects booking link when a call cue exists and clarify_only is not active", () => {
  const bookingLink = "https://calendly.com/d/cx6g-rr7-zkd/intro-call-with-fc";
  const input = ["Hi Blair,", "", "Happy to chat. Want to grab a quick 15-minute call?", "", "Best,", "Chris"].join("\n");

  const result = applyMissingBookingLinkForCallCue({
    draft: input,
    bookingLink,
    leadSchedulerLink: null,
    extraction: buildExtraction({
      needs_clarification: false,
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        responseMode: "info_then_booking",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(result.draft.includes(bookingLink));
});

test("applyInfoThenBookingNoTimeRequestGuard removes time-picking request when lead wants info first", () => {
  const input = [
    "Hi Monica,",
    "",
    "Here are a few details about membership.",
    "",
    "To make sure it's aligned: are you at or above $1M annual revenue?",
    "",
    "If so, what 2-3 times (ET) work for a quick 15-minute chat?",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const result = applyInfoThenBookingNoTimeRequestGuard({
    draft: input,
    extraction: buildExtraction({
      needs_clarification: false,
      decision_contract_v1: {
        contractVersion: "v1",
        isQualified: "no",
        hasBookingIntent: "no",
        shouldBookNow: "no",
        leadTimezone: "America/New_York",
        leadProposedWindows: [],
        needsPricingAnswer: "no",
        needsCommunityDetails: "yes",
        responseMode: "info_then_booking",
        evidence: [],
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/what 2-3 times/i.test(result.draft));
  assert.match(result.draft, /\$1M annual revenue/);
});

test("applyClarifyOnlyWindowStartTimeGuard rewrites anchored time question into an exact start-time question", () => {
  const input = [
    "Hi Cellene,",
    "",
    "Pricing is $9,500/year.",
    "",
    "For timing, does Tuesday the 17th at 10:00am Pacific work for a 15-minute chat?",
    "",
    "Best,",
    "Chris",
  ].join("\n");

  const result = applyClarifyOnlyWindowStartTimeGuard({
    draft: input,
    extraction: buildExtraction({
      evidence: ["“a chat Tuesday 17th after 10am works for me.”"],
      needs_clarification: true,
      decision_contract_v1: {
        ...buildExtraction().decision_contract_v1!,
        responseMode: "clarify_only",
      },
    }),
  });

  assert.equal(result.changed, true);
  assert.ok(!/10:00am/i.test(result.draft));
  assert.match(result.draft, /What exact start time on Tuesday the 17th \(after 10am Pacific\)/i);
});

test("applyInfoThenBookingNoTimeRequestGuard removes explicit time options even when not phrased as a question", () => {
  const input = [
    "Hi Shane,",
    "",
    "Membership includes mastermind groups and a 24/7 member network.",
    "",
    "If it's helpful, we can walk through it on a quick 15-minute call. Two options are 11:30 AM EST on Tue, Feb 17 or 4:00 PM EST on Wed, Feb 18.",
    "",
    "https://calendly.com/example/intro",
    "",
    "Which time works?",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const extraction = buildExtraction({
    needs_clarification: false,
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: "America/Denver",
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "yes",
      responseMode: "info_then_booking",
      evidence: [],
    },
  });

  const result = applyInfoThenBookingNoTimeRequestGuard({ draft: input, extraction });
  assert.equal(result.changed, true);
  assert.ok(!/Two options are/i.test(result.draft));
  assert.ok(!/Which time works/i.test(result.draft));
  assert.ok(result.draft.includes("calendly.com/example/intro"));
});

test("applyInfoThenBookingNoQualificationGatingGuard removes qualification gating clause when pricing isn't requested", () => {
  const input = [
    "Hi Shane,",
    "",
    "Membership is a private community for founders/operators doing $1M+ in annual revenue, with a mix of online access and in-person programming.",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const extraction = buildExtraction({
    needs_clarification: false,
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: "America/Denver",
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "yes",
      responseMode: "info_then_booking",
      evidence: [],
    },
  });

  const result = applyInfoThenBookingNoQualificationGatingGuard({ draft: input, extraction });
  assert.equal(result.changed, true);
  assert.ok(!/\\$1M\\+\\s+in\\s+annual\\s+revenue/i.test(result.draft));
  assert.match(result.draft, /for founders\/operators, with a mix/i);
});

test("applyInfoThenBookingNoQualificationQuestionGuard removes revenue gating questions in info_then_booking", () => {
  const input = [
    "Hi Monica,",
    "",
    "Membership includes masterminds and a 24/7 member network.",
    "",
    "To make sure it's aligned: are you currently at or above the $1m annual revenue mark?",
    "If yes, we can do a quick 15-minute call to walk through details.",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const extraction = buildExtraction({
    needs_clarification: false,
    decision_contract_v1: {
      contractVersion: "v1",
      isQualified: "no",
      hasBookingIntent: "no",
      shouldBookNow: "no",
      leadTimezone: "America/New_York",
      leadProposedWindows: [],
      needsPricingAnswer: "no",
      needsCommunityDetails: "yes",
      responseMode: "info_then_booking",
      evidence: [],
    },
  });

  const result = applyInfoThenBookingNoQualificationQuestionGuard({ draft: input, extraction });
  assert.equal(result.changed, true);
  assert.ok(!/annual revenue/i.test(result.draft));
  assert.match(result.draft, /If helpful, we can do a quick 15-minute call/i);
});

test("applyShouldBookNowConfirmationIfNeeded ignores incidental slot mentions when draft isn't a confirmation", () => {
  const availability = ["Tue, Feb 17 at 9:00 AM PST", "Tue, Feb 17 at 1:30 PM PST"];
  const extraction = buildExtraction({
    accepted_slot_index: null,
    decision_contract_v1: {
      ...buildExtraction().decision_contract_v1!,
      shouldBookNow: "yes",
    },
  });

  const result = applyShouldBookNowConfirmationIfNeeded({
    draft: "Great - Tue, Feb 17 at 1:30 PM PST works.",
    channel: "sms",
    firstName: null,
    aiName: "Chris",
    extraction,
    availability,
  });

  assert.equal(result, "Booked for Tue, Feb 17 at 9:00 AM PST.");
});

test("applyShouldBookNowConfirmationIfNeeded prefers accepted_slot_index when provided", () => {
  const availability = ["Tue, Feb 17 at 9:00 AM PST", "Tue, Feb 17 at 1:30 PM PST"];
  const extraction = buildExtraction({
    accepted_slot_index: 2,
    decision_contract_v1: {
      ...buildExtraction().decision_contract_v1!,
      shouldBookNow: "yes",
    },
  });

  const result = applyShouldBookNowConfirmationIfNeeded({
    draft: "Thanks!",
    channel: "sms",
    firstName: null,
    aiName: "Chris",
    extraction,
    availability,
  });

  assert.equal(result, "Booked for Tue, Feb 17 at 1:30 PM PST.");
});

test("applyShouldBookNowConfirmationIfNeeded keeps an existing booked confirmation that references an offered slot", () => {
  const availability = ["Tue, Feb 17 at 9:00 AM PST", "Tue, Feb 17 at 1:30 PM PST"];
  const extraction = buildExtraction({
    accepted_slot_index: 1,
    decision_contract_v1: {
      ...buildExtraction().decision_contract_v1!,
      shouldBookNow: "yes",
    },
  });

  const draft = "Booked for Tue, Feb 17 at 1:30 PM PST.";
  const result = applyShouldBookNowConfirmationIfNeeded({
    draft,
    channel: "sms",
    firstName: null,
    aiName: "Chris",
    extraction,
    availability,
  });

  assert.equal(result, draft);
});

test("applyShouldBookNowConfirmationIfNeeded adds a concise open-point acknowledgement for founders club email confirmations", () => {
  const availability = ["Fri, Mar 6 at 12:30 PM PST", "Fri, Mar 6 at 2:00 PM PST"];
  const extraction = buildExtraction({
    accepted_slot_index: 1,
    decision_contract_v1: {
      ...buildExtraction().decision_contract_v1!,
      shouldBookNow: "yes",
      needsPricingAnswer: "yes",
      needsCommunityDetails: "yes",
    },
  });

  const result = applyShouldBookNowConfirmationIfNeeded({
    draft: "Friday 12 to 3pm PST works for me.",
    channel: "email",
    firstName: "Taylor",
    aiName: "Chris",
    extraction,
    availability,
    clientId: FOUNDERS_CLUB_CLIENT_ID,
    latestInboundText:
      "Subject: Invite to Seattle founder-only event\n\nFriday 12 to 3pm PST works. Also what's included and how often can members attend?",
  });

  assert.match(result, /^Hi Taylor,/);
  assert.match(result, /You're booked for Fri, Mar 6 at 12:30 PM PST\./);
  assert.match(result, /we can cover them on the call/i);
});

test("applyShouldBookNowConfirmationIfNeeded does not add founders-club acknowledgement for non-founders workspaces", () => {
  const availability = ["Fri, Mar 6 at 12:30 PM PST", "Fri, Mar 6 at 2:00 PM PST"];
  const extraction = buildExtraction({
    accepted_slot_index: 1,
    decision_contract_v1: {
      ...buildExtraction().decision_contract_v1!,
      shouldBookNow: "yes",
      needsPricingAnswer: "yes",
      needsCommunityDetails: "yes",
    },
  });

  const result = applyShouldBookNowConfirmationIfNeeded({
    draft: "Friday 12 to 3pm PST works for me.",
    channel: "email",
    firstName: "Taylor",
    aiName: "Chris",
    extraction,
    availability,
    clientId: "0c6b94f8-8840-4a5e-938b-4864a9cfde8f",
    latestInboundText:
      "Subject: Invite to Seattle founder-only event\n\nFriday 12 to 3pm PST works. Also what's included and how often can members attend?",
  });

  assert.match(result, /^Hi Taylor,/);
  assert.match(result, /You're booked for Fri, Mar 6 at 12:30 PM PST\./);
  assert.ok(!/we can cover them on the call/i.test(result));
});

test("applyContactUpdateNoSchedulingGuard rewrites scheduling content into a simple contact-update confirmation", () => {
  const inbound = "Please use suzanne@agsmls.com as I do not regularly receive this email in my outlook account.";
  const draft = [
    "Hi Suzanne,",
    "",
    "Confirmed, we'll use suzanne@agsmls.com going forward.",
    "",
    "Does 12:30 PM EST on Tue, Feb 17 work for a quick 15-minute call?",
    "",
    "You can grab a time here: https://calendly.com/example/intro",
    "",
    "Best,",
    "Aaron",
  ].join("\n");

  const result = applyContactUpdateNoSchedulingGuard({
    draft,
    latestInboundText: inbound,
    channel: "email",
    firstName: "Suzanne",
    aiName: "Aaron",
  });

  assert.equal(result.changed, true);
  assert.match(result.draft, /suzanne@agsmls\.com/i);
  assert.ok(!/calendly/i.test(result.draft));
  assert.ok(!/12:30/i.test(result.draft));
});
