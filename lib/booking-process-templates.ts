/**
 * Booking Process Template Definitions (Phase 36)
 *
 * Static template definitions for common booking processes.
 * These are not server actions so they can be used synchronously.
 */

import type { BookingProcessLinkType } from "@prisma/client";

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
