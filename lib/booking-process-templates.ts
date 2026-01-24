/**
 * Booking Process Template Definitions (Phase 36)
 *
 * Static template definitions for common booking processes.
 * These are not server actions so they can be used synchronously.
 */

import type { BookingProcessLinkType, BookingStageInstructionOrder } from "@prisma/client";

export type BookingProcessStageInput = {
  id?: string;
  stageNumber: number;
  includeBookingLink: boolean;
  linkType: BookingProcessLinkType;
  includeSuggestedTimes: boolean;
  numberOfTimesToSuggest: number;
  includeQualifyingQuestions: boolean;
  qualificationQuestionIds: string[];
  includeTimezoneAsk: boolean;
  instructionOrder?: BookingStageInstructionOrder | null;
  applyToEmail: boolean;
  applyToSms: boolean;
  applyToLinkedin: boolean;
};

export type TemplateBookingProcess = {
  name: string;
  description: string;
  stages: BookingProcessStageInput[];
};

export const BOOKING_PROCESS_TEMPLATES: TemplateBookingProcess[] = [
  {
    name: "Link + Qualification (No Times)",
    description: "Ask qualifying question(s) first, then provide the booking link. No suggested times.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: true,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: true,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        instructionOrder: "QUESTIONS_FIRST",
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Initial Email Times (EmailBison availability_slot)",
    description:
      "Use when the first outbound email already includes offered times (via EmailBison availability_slot) and inbound selection should auto-book.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: false,
        applyToLinkedin: false,
      },
    ],
  },
  {
    name: "Lead Proposes Times (Auto-Book When Clear)",
    description: "Auto-book when the lead proposes a specific time and the match is high-confidence.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Call Requested (Create Call Task)",
    description: "When the lead requests a call and provides a phone number, create a call task + notify.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Lead Provided Calendar Link (Escalate or Schedule)",
    description:
      "When the lead asks to book via their own calendar link, attempt scheduling when supported; otherwise escalate.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Direct Link First",
    description: "Send booking link immediately on first reply. Best for SaaS/tech leads.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: true,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Times + Question First",
    description: "Suggest times and ask qualifying question, then send link. More personal approach.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: true,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: true,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        instructionOrder: "TIMES_FIRST",
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
      {
        stageNumber: 2,
        includeBookingLink: true,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Relationship Builder",
    description: "Build rapport first, then suggest times, then link. Best for cold leads.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
      {
        stageNumber: 2,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: true,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: true,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        instructionOrder: "TIMES_FIRST",
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
      {
        stageNumber: 3,
        includeBookingLink: true,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Times Only",
    description: "Suggest times without booking link or questions. Simple, low-friction.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: true,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        instructionOrder: "TIMES_FIRST",
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
      {
        stageNumber: 2,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: true,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        instructionOrder: "TIMES_FIRST",
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
  {
    name: "Times Then Link",
    description: "Suggest times twice to build connection, then send link. Local service businesses.",
    stages: [
      {
        stageNumber: 1,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: true,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
      {
        stageNumber: 2,
        includeBookingLink: false,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: true,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
      {
        stageNumber: 3,
        includeBookingLink: true,
        linkType: "PLAIN_URL",
        includeSuggestedTimes: false,
        numberOfTimesToSuggest: 3,
        includeQualifyingQuestions: false,
        qualificationQuestionIds: [],
        includeTimezoneAsk: false,
        applyToEmail: true,
        applyToSms: true,
        applyToLinkedin: true,
      },
    ],
  },
];
