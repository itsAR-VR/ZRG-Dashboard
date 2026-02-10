import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Prompt Snippets (Phase 47)
 *
 * Reusable text blocks that can be referenced in prompts via placeholders
 * like {forbiddenTerms}. Each snippet has a canonical default value defined
 * in code, and workspaces can override them via PromptSnippetOverride.
 */

// =============================================================================
// Canonical Snippet Defaults
// =============================================================================

/**
 * Default forbidden terms for email draft generation.
 * These words/phrases tend to make AI-generated text sound unnatural.
 */
// =============================================================================
// Email Length Configuration (Phase 47g)
// =============================================================================

/**
 * Default template for email length rules instruction block.
 * Uses {minChars} and {maxChars} placeholders that are replaced at runtime.
 */
export const DEFAULT_EMAIL_LENGTH_RULES_TEMPLATE = `
LENGTH REQUIREMENTS (STRICT):
- Output must be between {minChars} and {maxChars} characters (including spaces).
- Do not mention character counts.
- If you would exceed {maxChars}, shorten the email while keeping the core intent + CTA.
- If you are under {minChars}, add 1–2 short, useful sentences (no fluff).`.trim();

/**
 * Default min/max character bounds for email drafts.
 * These are overridden by environment variables first, then by workspace snippet overrides.
 */
export const DEFAULT_EMAIL_LENGTH_MIN_CHARS = 220;
export const DEFAULT_EMAIL_LENGTH_MAX_CHARS = 1200;

// =============================================================================
// Email Draft Structure Archetypes (Phase 47g)
// =============================================================================

/**
 * Default archetype instructions keyed by archetype ID.
 * These define the structural patterns for email generation.
 */
export const DEFAULT_ARCHETYPE_INSTRUCTIONS: Record<string, string> = {
  A1_short_paragraph_bullets_question: `Structure: One short opening paragraph (2-3 sentences max), then 2-3 bullet points highlighting value, end with a single question. Keep total length under 100 words.`,
  A2_question_first_opener: `Structure: Open with a direct question that relates to their situation. Follow with 2 sentences of context/value. Close with a soft call-to-action. No bullets.`,
  A3_two_line_micro_story: `Structure: Two-line opener (greeting + hook), then a brief micro-story (1-2 sentences about a similar situation/result), then invitation. Keep conversational.`,
  A4_direct_scheduling_first: `Structure: Lead with the scheduling ask immediately after greeting. Then provide 1-2 sentences of context why. Include specific times if available. No fluff.`,
  A5_empathy_bridge: `Structure: Open by acknowledging their situation/response. Bridge with "I thought..." or "That's why...". Close with a low-pressure next step. No bullets, conversational tone.`,
  A6_single_paragraph_dense: `Structure: One cohesive paragraph (4-5 sentences). Pack value proposition, relevance to them, and call-to-action into a single flowing block. No line breaks.`,
  A7_numbered_list_value: `Structure: Brief opener (1 sentence), then numbered list (1. 2. 3.) of specific benefits relevant to them, then closing question. Keep each number to one line.`,
  A8_casual_ps_hook: `Structure: Very brief main message (2-3 sentences, casual tone). Add a P.S. line with the key hook or scheduling link. The P.S. should be the most compelling part.`,
  A9_comparison_contrast: `Structure: Open with a quick contrast (before vs after, or common approach vs better approach). 2 sentences max. Then bridge to how you help. Close with availability.`,
  A10_social_proof_anchor: `Structure: Open by referencing a relevant result or company (if available from context). Bridge to their situation. Close with scheduling. Keep proof specific, not generic.`,
};

// =============================================================================
// Forbidden Terms (Phase 47e)
// =============================================================================

/**
 * Default forbidden terms for email draft generation.
 * These words/phrases tend to make AI-generated text sound unnatural.
 */
export const DEFAULT_FORBIDDEN_TERMS = [
  "Tailored",
  "Surface",
  "Actionable",
  "Accordingly",
  "Additionally",
  "Arguably",
  "Certainly",
  "Consequently",
  "Hence",
  "However",
  "Indeed",
  "Moreover",
  "Nevertheless",
  "Nonetheless",
  "Notwithstanding",
  "Thus",
  "Undoubtedly",
  "Adept",
  "Commendable",
  "Dynamic",
  "Efficient",
  "Ever-evolving",
  "Exciting",
  "Exemplary",
  "Innovative",
  "Invaluable",
  "Robust",
  "Seamless",
  "Synergistic",
  "Thought-provoking",
  "Transformative",
  "Utmost",
  "Vibrant",
  "Vital",
  "Efficiency",
  "Innovation",
  "Institution",
  "Integration",
  "Implementation",
  "Landscape",
  "Optimization",
  "Realm",
  "Tapestry",
  "Transformation",
  "Aligns",
  "Augment",
  "Delve",
  "Embark",
  "Facilitate",
  "Maximize",
  "Underscores",
  "Utilize",
  "A testament to…",
  "In conclusion…",
  "In summary…",
  "It's important to note/consider…",
  "It's worth noting that…",
  "On the contrary…",
  "Deliver actionable insights through in-depth data analysis",
  "Drive insightful data-driven decisions",
  "Leveraging data-driven insights",
  "Leveraging complex datasets to extract meaningful insights",
  "Overly complex sentence structures",
  "An unusually formal tone in text that's supposed to be conversational or casual",
  "An overly casual tone for a text that's supposed to be formal or business casual",
  "Unnecessarily long and wordy",
  "Vague statements",
  "Note",
  "Your note",
  "Thanks for your note",
];

/**
 * Snippet key registry — maps snippet keys to their default values.
 * Add new snippets here as they are created.
 *
 * Keys:
 * - forbiddenTerms: newline-separated list of words/phrases to avoid
 * - emailLengthRulesTemplate: instruction block with {minChars}/{maxChars} placeholders
 * - emailLengthMinChars: minimum character count (number as string)
 * - emailLengthMaxChars: maximum character count (number as string)
 * - emailArchetype.{id}.instructions: archetype-specific instructions
 */
export const SNIPPET_DEFAULTS: Record<string, string> = {
  forbiddenTerms: DEFAULT_FORBIDDEN_TERMS.join("\n"),
  emailLengthRulesTemplate: DEFAULT_EMAIL_LENGTH_RULES_TEMPLATE,
  emailLengthMinChars: String(DEFAULT_EMAIL_LENGTH_MIN_CHARS),
  emailLengthMaxChars: String(DEFAULT_EMAIL_LENGTH_MAX_CHARS),
  // Add archetype instruction defaults
  ...Object.fromEntries(
    Object.entries(DEFAULT_ARCHETYPE_INSTRUCTIONS).map(([id, instructions]) => [
      `emailArchetype.${id}.instructions`,
      instructions,
    ])
  ),
};

/**
 * Get the list of all snippet keys (for UI display).
 */
export function listSnippetKeys(): string[] {
  return Object.keys(SNIPPET_DEFAULTS);
}

/**
 * Get the default value for a snippet key.
 */
export function getSnippetDefault(snippetKey: string): string | null {
  return SNIPPET_DEFAULTS[snippetKey] ?? null;
}

// =============================================================================
// Snippet Formatting Utilities
// =============================================================================

/**
 * Format snippet as comma-separated list (for inline use).
 */
export function formatSnippetAsCommaSeparated(content: string): string {
  return content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30) // Limit for inline use
    .join(", ");
}

/**
 * Format snippet as newline-separated list (for block use).
 */
export function formatSnippetAsNewlineSeparated(content: string): string {
  return content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

// =============================================================================
// Snippet Override Lookup
// =============================================================================

/**
 * Get a snippet's effective value (override or default) for a workspace.
 * Returns null if the snippet key doesn't exist.
 */
export async function getEffectiveSnippet(
  snippetKey: string,
  clientId: string
): Promise<{ content: string; isOverride: boolean; updatedAt: Date | null } | null> {
  const defaultValue = SNIPPET_DEFAULTS[snippetKey];
  if (!defaultValue) return null;

  const [workspaceOverride, systemOverride] = await Promise.all([
    prisma.promptSnippetOverride.findUnique({
      where: { clientId_snippetKey: { clientId, snippetKey } },
      select: { content: true, updatedAt: true },
    }),
    prisma.systemPromptSnippetOverride.findUnique({
      where: { snippetKey },
      select: { content: true, updatedAt: true },
    }),
  ]);

  if (workspaceOverride) {
    return { content: workspaceOverride.content, isOverride: true, updatedAt: workspaceOverride.updatedAt };
  }

  if (systemOverride) {
    return { content: systemOverride.content, isOverride: true, updatedAt: systemOverride.updatedAt };
  }

  return { content: defaultValue, isOverride: false, updatedAt: null };
}

/**
 * Get effective forbidden terms for email draft generation.
 * Convenience wrapper for the most common snippet.
 */
export async function getEffectiveForbiddenTerms(
  clientId: string
): Promise<{ terms: string[]; isOverride: boolean; updatedAt: Date | null }> {
  const result = await getEffectiveSnippet("forbiddenTerms", clientId);
  if (!result) {
    // Fallback to default (should never happen if SNIPPET_DEFAULTS is correct)
    return { terms: DEFAULT_FORBIDDEN_TERMS, isOverride: false, updatedAt: null };
  }

  const terms = result.content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return { terms, isOverride: result.isOverride, updatedAt: result.updatedAt };
}

/**
 * Get all snippet overrides for a workspace (for UI display).
 */
export async function getSnippetOverridesForWorkspace(
  clientId: string
): Promise<Array<{ snippetKey: string; content: string; updatedAt: Date }>> {
  const overrides = await prisma.promptSnippetOverride.findMany({
    where: { clientId },
    select: { snippetKey: true, content: true, updatedAt: true },
    orderBy: { snippetKey: "asc" },
  });
  return overrides;
}

// =============================================================================
// Email Length Bounds Helpers (Phase 47g)
// =============================================================================

/**
 * Get effective email length bounds for a workspace.
 * Priority: workspace override → env variable → code default
 */
export async function getEffectiveEmailLengthBounds(
  clientId: string
): Promise<{
  minChars: number;
  maxChars: number;
  isOverride: boolean;
}> {
  // First check for workspace/system overrides
  const [minOverride, maxOverride] = await Promise.all([
    getEffectiveSnippet("emailLengthMinChars", clientId),
    getEffectiveSnippet("emailLengthMaxChars", clientId),
  ]);

  const hasOverride = minOverride?.isOverride || maxOverride?.isOverride;

  // Parse override or fallback to env/default
  const envMin = Number.parseInt(process.env.OPENAI_EMAIL_DRAFT_MIN_CHARS || "", 10);
  const envMax = Number.parseInt(process.env.OPENAI_EMAIL_DRAFT_MAX_CHARS || "", 10);

  let minChars: number;
  let maxChars: number;

  if (minOverride?.isOverride) {
    const parsed = Number.parseInt(minOverride.content, 10);
    minChars = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMAIL_LENGTH_MIN_CHARS;
  } else {
    minChars = Number.isFinite(envMin) && envMin > 0 ? envMin : DEFAULT_EMAIL_LENGTH_MIN_CHARS;
  }

  if (maxOverride?.isOverride) {
    const parsed = Number.parseInt(maxOverride.content, 10);
    maxChars = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMAIL_LENGTH_MAX_CHARS;
  } else {
    maxChars = Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_EMAIL_LENGTH_MAX_CHARS;
  }

  // Sanity check: ensure max > min
  if (maxChars <= minChars) {
    maxChars = Math.max(minChars + 200, DEFAULT_EMAIL_LENGTH_MAX_CHARS);
  }

  return { minChars, maxChars, isOverride: Boolean(hasOverride) };
}

/**
 * Build the email length rules instruction block for a workspace.
 * Uses the template with bounds substituted.
 */
export async function buildEffectiveEmailLengthRules(
  clientId: string
): Promise<{ rules: string; bounds: { minChars: number; maxChars: number }; isOverride: boolean }> {
  const [templateResult, bounds] = await Promise.all([
    getEffectiveSnippet("emailLengthRulesTemplate", clientId),
    getEffectiveEmailLengthBounds(clientId),
  ]);

  const template = templateResult?.content || DEFAULT_EMAIL_LENGTH_RULES_TEMPLATE;
  const rules = template
    .replace(/\{minChars\}/g, String(bounds.minChars))
    .replace(/\{maxChars\}/g, String(bounds.maxChars));

  return {
    rules: `\n\n${rules}`,
    bounds,
    isOverride: templateResult?.isOverride || bounds.isOverride,
  };
}

// =============================================================================
// Archetype Instructions Helpers (Phase 47g)
// =============================================================================

/**
 * Get effective archetype instructions for a specific archetype ID.
 * Returns the override if present, otherwise the default.
 */
export async function getEffectiveArchetypeInstructions(
  archetypeId: string,
  clientId: string
): Promise<{ instructions: string; isOverride: boolean }> {
  const snippetKey = `emailArchetype.${archetypeId}.instructions`;
  const result = await getEffectiveSnippet(snippetKey, clientId);

  if (result) {
    return { instructions: result.content, isOverride: result.isOverride };
  }

  // Fallback to hardcoded default if snippet key doesn't exist
  const defaultInstructions = DEFAULT_ARCHETYPE_INSTRUCTIONS[archetypeId];
  return {
    instructions: defaultInstructions || "",
    isOverride: false,
  };
}
