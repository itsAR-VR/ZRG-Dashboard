import { expandSpintax } from "./spintax";

export type FollowUpTemplateValueKey =
  // Lead variables
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "leadCompanyName"
  // Workspace variables
  | "aiPersonaName"
  | "signature"
  | "companyName"
  | "targetResult"
  | "qualificationQuestion1"
  | "qualificationQuestion2"
  // Booking/availability variables (computed at runtime)
  | "bookingLink"
  | "availability"
  | "timeOption1"
  | "timeOption2";

export type FollowUpTemplateTokenSource = "lead" | "workspace" | "booking" | "availability" | "qualification";

export type FollowUpTemplateTokenDefinition = {
  token: string;
  valueKey: FollowUpTemplateValueKey;
  source: FollowUpTemplateTokenSource;
  isAlias?: boolean;
};

export const FOLLOWUP_TEMPLATE_TOKEN_DEFINITIONS: readonly FollowUpTemplateTokenDefinition[] = [
  // Lead (canonical + aliases)
  { token: "{firstName}", valueKey: "firstName", source: "lead" },
  { token: "{FIRST_NAME}", valueKey: "firstName", source: "lead", isAlias: true },
  { token: "{FIRST\\_NAME}", valueKey: "firstName", source: "lead", isAlias: true },
  { token: "{{contact.first_name}}", valueKey: "firstName", source: "lead", isAlias: true },
  { token: "{{contact.first\\_name}}", valueKey: "firstName", source: "lead", isAlias: true },
  { token: "{lastName}", valueKey: "lastName", source: "lead" },
  { token: "{email}", valueKey: "email", source: "lead" },
  { token: "{phone}", valueKey: "phone", source: "lead" },
  { token: "{leadCompanyName}", valueKey: "leadCompanyName", source: "lead" },

  // Workspace/company (canonical + aliases)
  { token: "{senderName}", valueKey: "aiPersonaName", source: "workspace" },
  { token: "{name}", valueKey: "aiPersonaName", source: "workspace", isAlias: true },
  { token: "{signature}", valueKey: "signature", source: "workspace" },
  { token: "{companyName}", valueKey: "companyName", source: "workspace" },
  { token: "{company}", valueKey: "companyName", source: "workspace", isAlias: true },
  { token: "{result}", valueKey: "targetResult", source: "workspace" },
  { token: "{achieving result}", valueKey: "targetResult", source: "workspace", isAlias: true },

  // Booking + availability
  { token: "{availability}", valueKey: "availability", source: "availability" },
  { token: "{calendarLink}", valueKey: "bookingLink", source: "booking" },
  { token: "{link}", valueKey: "bookingLink", source: "booking", isAlias: true },
  { token: "{time 1 day 1}", valueKey: "timeOption1", source: "availability" },
  { token: "{time 2 day 2}", valueKey: "timeOption2", source: "availability" },
  { token: "{x day x time}", valueKey: "timeOption1", source: "availability", isAlias: true },
  { token: "{y day y time}", valueKey: "timeOption2", source: "availability", isAlias: true },

  // Qualification questions
  { token: "{qualificationQuestion1}", valueKey: "qualificationQuestion1", source: "qualification" },
  { token: "{qualificationQuestion2}", valueKey: "qualificationQuestion2", source: "qualification" },
  { token: "{qualification question 1}", valueKey: "qualificationQuestion1", source: "qualification", isAlias: true },
  { token: "{qualification question 2}", valueKey: "qualificationQuestion2", source: "qualification", isAlias: true },
];

const TOKEN_DEFINITION_BY_TOKEN = new Map(
  FOLLOWUP_TEMPLATE_TOKEN_DEFINITIONS.map((definition) => [definition.token, definition])
);

export const FOLLOWUP_TEMPLATE_TOKENS_BY_SOURCE: Record<FollowUpTemplateTokenSource, FollowUpTemplateTokenDefinition[]> =
  {
    lead: [],
    workspace: [],
    booking: [],
    availability: [],
    qualification: [],
  };

for (const definition of FOLLOWUP_TEMPLATE_TOKEN_DEFINITIONS) {
  FOLLOWUP_TEMPLATE_TOKENS_BY_SOURCE[definition.source].push(definition);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const TOKEN_REGEX = /\{\{[^}]+\}\}|\{[^}]+\}/g;

export function extractFollowUpTemplateTokens(template: string | null | undefined): string[] {
  if (!template) return [];
  const matches = template.match(TOKEN_REGEX) ?? [];
  return Array.from(new Set(matches.map((m) => m.trim()))).filter(Boolean);
}

export function getUnknownFollowUpTemplateTokens(template: string | null | undefined): string[] {
  const tokens = extractFollowUpTemplateTokens(template);
  return tokens.filter((token) => !TOKEN_DEFINITION_BY_TOKEN.has(token));
}

export function parseQualificationQuestions(json: string | null): Array<{ id: string; question: string }> {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type FollowUpTemplateValues = Partial<Record<FollowUpTemplateValueKey, string | null | undefined>>;

export type FollowUpTemplateError =
  | { type: "unknown_token"; token: string; message: string }
  | { type: "missing_value"; token: string; valueKey: FollowUpTemplateValueKey; message: string }
  | { type: "spintax_error"; message: string };

const MISSING_HINT_BY_VALUE_KEY: Record<FollowUpTemplateValueKey, string> = {
  firstName: "Lead is missing first name",
  lastName: "Lead is missing last name",
  email: "Lead is missing email",
  phone: "Lead is missing phone",
  leadCompanyName: "Lead is missing company name",
  aiPersonaName: "Workspace is missing AI Persona name (aiPersonaName)",
  signature: "Workspace or persona is missing signature",
  companyName: "Workspace is missing company name",
  targetResult: "Workspace is missing target result/outcome",
  bookingLink: "Workspace is missing calendar link / booking link",
  availability: "Availability is not available (no slots configured/returned)",
  timeOption1: "Availability slot #1 is not available",
  timeOption2: "Availability slot #2 is not available",
  qualificationQuestion1: "Qualification question 1 is not configured",
  qualificationQuestion2: "Qualification question 2 is not configured",
};

export function renderFollowUpTemplateStrict(opts: {
  template: string | null | undefined;
  values: FollowUpTemplateValues;
  spintaxSeed?: string;
}): { ok: true; output: string; usedTokens: string[] } | { ok: false; errors: FollowUpTemplateError[]; usedTokens: string[] } {
  const template = opts.template ?? "";
  if (!template) return { ok: true, output: "", usedTokens: [] };

  let expandedTemplate = template;
  if (template.includes("[[")) {
    const expanded = expandSpintax(template, { seed: opts.spintaxSeed ?? "" });
    if (!expanded.ok) {
      return {
        ok: false,
        errors: [{ type: "spintax_error", message: expanded.error }],
        usedTokens: [],
      };
    }
    expandedTemplate = expanded.output;
  }

  const usedTokens = extractFollowUpTemplateTokens(expandedTemplate);
  const errors: FollowUpTemplateError[] = [];

  for (const token of usedTokens) {
    const definition = TOKEN_DEFINITION_BY_TOKEN.get(token);
    if (!definition) {
      errors.push({ type: "unknown_token", token, message: `Unknown template variable: ${token}` });
      continue;
    }

    const value = opts.values[definition.valueKey];
    if (!isNonEmptyString(value)) {
      errors.push({
        type: "missing_value",
        token,
        valueKey: definition.valueKey,
        message: `Missing value for ${token}: ${MISSING_HINT_BY_VALUE_KEY[definition.valueKey]}`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors, usedTokens };

  let output = expandedTemplate;
  for (const token of usedTokens) {
    const definition = TOKEN_DEFINITION_BY_TOKEN.get(token);
    if (!definition) continue;
    const value = opts.values[definition.valueKey];
    // Re-validate before rendering: fail-fast if value is not a non-empty string
    // (guards against mutation between validation and rendering phases)
    if (!isNonEmptyString(value)) {
      throw new Error(
        `[followup-template] Invariant violation: value for ${token} became invalid after validation. ` +
          `Expected non-empty string, got: ${typeof value === "string" ? `"${value}"` : String(value)}`
      );
    }
    output = output.split(token).join(value);
  }

  return { ok: true, output, usedTokens };
}
