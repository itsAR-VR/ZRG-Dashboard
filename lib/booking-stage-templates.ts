/**
 * Booking Stage Instruction Templates (Phase 47k)
 *
 * Defines the default templates for booking process stage instructions
 * and provides utilities for rendering templates with placeholders.
 */

/**
 * All template keys supported for per-stage instruction customization.
 */
export const BOOKING_STAGE_TEMPLATE_KEYS = [
  "bookingLinkPlainTemplate",
  "bookingLinkHyperlinkTemplate",
  "noBookingLinkTemplate",
  "suggestedTimesWithSlotsTemplate",
  "suggestedTimesNoSlotsTemplate",
  "qualifyingQuestionOneTemplate",
  "qualifyingQuestionManyTemplate",
  "smsParaphraseHintTemplate",
  "timezoneAskTemplate",
  "earlyAcceptanceHintTemplate",
  "stageBlockWrapperTemplate",
] as const;

export type BookingStageTemplateKey = (typeof BOOKING_STAGE_TEMPLATE_KEYS)[number];

/**
 * Default templates for booking stage instructions.
 * These are used when no override is set for a stage.
 */
export const DEFAULT_BOOKING_STAGE_TEMPLATES: Record<BookingStageTemplateKey, string> = {
  // Booking link templates
  bookingLinkPlainTemplate:
    "Include the booking link as a plain URL in your response: {bookingLink}",
  bookingLinkHyperlinkTemplate:
    'Include a booking link as hyperlinked text (e.g., "book a time here" or "schedule a call"). Link URL: {bookingLink}',
  noBookingLinkTemplate:
    'IMPORTANT: No booking link is configured for this workspace. Do NOT include any placeholder text like "{booking link}", "{insert booking link}", "[booking link]", or similar. Instead, ask the lead for their availability or offer to send specific times.',

  // Suggested times templates
  suggestedTimesWithSlotsTemplate:
    "Suggest {numTimes} specific times for a call. Use these available slots verbatim:\n{timesBullets}",
  suggestedTimesNoSlotsTemplate:
    "Suggest {numTimes} potential meeting times. If you don't have specific availability, propose to send options or ask for their availability.",

  // Qualifying questions templates
  qualifyingQuestionOneTemplate:
    'Ask this qualifying question naturally in your response: "{question}"',
  qualifyingQuestionManyTemplate:
    "Ask these qualifying questions naturally in your response:\n{questionsBullets}",
  smsParaphraseHintTemplate:
    "Note: Keep questions brief for SMS. Paraphrase if needed to stay under 160 characters.",

  // Timezone ask template
  timezoneAskTemplate:
    "Ask what timezone the lead is in so you can confirm meeting times work for them.",

  // Early acceptance hint (when suggested times but no booking link)
  earlyAcceptanceHintTemplate:
    "If the lead clearly accepts one of the suggested times, confirm that specific time and proceed with booking. Don't require them to click a booking link if they've already said yes to a time.",

  // Stage block wrapper template
  stageBlockWrapperTemplate: `
BOOKING PROCESS INSTRUCTIONS (Stage {stageNumber}):
{bullets}

Important: Follow these booking instructions carefully. They are based on the campaign's booking strategy.`,
};

/**
 * Type for instruction templates stored on a BookingProcessStage.
 */
export type BookingStageTemplates = Partial<Record<BookingStageTemplateKey, string>>;

/**
 * Get the effective template for a key, using override if present, else default.
 */
export function getEffectiveTemplate(
  key: BookingStageTemplateKey,
  overrides: BookingStageTemplates | null | undefined
): string {
  if (overrides && typeof overrides[key] === "string" && overrides[key].trim()) {
    return overrides[key] as string;
  }
  return DEFAULT_BOOKING_STAGE_TEMPLATES[key];
}

/**
 * Simple template renderer that replaces {placeholder} with values.
 * Safe: only replaces known placeholders, no eval.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string | number>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    // Use global replace for all occurrences
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

/**
 * Get the template registry for UI display.
 * Returns all template keys with their labels, descriptions, and default values.
 */
export function getBookingStageTemplateRegistry(): Array<{
  key: BookingStageTemplateKey;
  label: string;
  description: string;
  placeholders: string[];
  defaultValue: string;
}> {
  return [
    {
      key: "bookingLinkPlainTemplate",
      label: "Booking Link (Plain URL)",
      description: "Instruction for including booking link as plain text URL",
      placeholders: ["{bookingLink}"],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.bookingLinkPlainTemplate,
    },
    {
      key: "bookingLinkHyperlinkTemplate",
      label: "Booking Link (Hyperlink)",
      description: "Instruction for including booking link as hyperlinked text (email only)",
      placeholders: ["{bookingLink}"],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.bookingLinkHyperlinkTemplate,
    },
    {
      key: "noBookingLinkTemplate",
      label: "No Booking Link Warning",
      description: "Warning when no booking link is configured",
      placeholders: [],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.noBookingLinkTemplate,
    },
    {
      key: "suggestedTimesWithSlotsTemplate",
      label: "Suggested Times (With Slots)",
      description: "Instruction for suggesting specific available times",
      placeholders: ["{numTimes}", "{timesBullets}"],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.suggestedTimesWithSlotsTemplate,
    },
    {
      key: "suggestedTimesNoSlotsTemplate",
      label: "Suggested Times (No Slots)",
      description: "Instruction when no specific availability slots are provided",
      placeholders: ["{numTimes}"],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.suggestedTimesNoSlotsTemplate,
    },
    {
      key: "qualifyingQuestionOneTemplate",
      label: "Qualifying Question (Single)",
      description: "Instruction for asking one qualifying question",
      placeholders: ["{question}"],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.qualifyingQuestionOneTemplate,
    },
    {
      key: "qualifyingQuestionManyTemplate",
      label: "Qualifying Questions (Multiple)",
      description: "Instruction for asking multiple qualifying questions",
      placeholders: ["{questionsBullets}"],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.qualifyingQuestionManyTemplate,
    },
    {
      key: "smsParaphraseHintTemplate",
      label: "SMS Paraphrase Hint",
      description: "Hint for SMS channel to keep questions brief",
      placeholders: [],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.smsParaphraseHintTemplate,
    },
    {
      key: "timezoneAskTemplate",
      label: "Timezone Ask",
      description: "Instruction to ask about lead's timezone",
      placeholders: [],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.timezoneAskTemplate,
    },
    {
      key: "earlyAcceptanceHintTemplate",
      label: "Early Acceptance Hint",
      description: "Instruction for handling early time acceptance",
      placeholders: [],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.earlyAcceptanceHintTemplate,
    },
    {
      key: "stageBlockWrapperTemplate",
      label: "Stage Block Wrapper",
      description: "Template for wrapping the entire stage instruction block",
      placeholders: ["{stageNumber}", "{bullets}"],
      defaultValue: DEFAULT_BOOKING_STAGE_TEMPLATES.stageBlockWrapperTemplate,
    },
  ];
}
