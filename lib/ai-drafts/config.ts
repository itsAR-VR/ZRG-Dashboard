/**
 * Draft Generation Model Configuration
 *
 * Coercion helpers for validating/defaulting workspace settings before passing to OpenAI.
 * Mirrors the pattern in lib/insights-chat/config.ts.
 */

export const DRAFT_GENERATION_MODELS = ["gpt-5.1", "gpt-5.2"] as const;
export type DraftGenerationModel = (typeof DRAFT_GENERATION_MODELS)[number];

export const DRAFT_GENERATION_EFFORTS = ["low", "medium", "high", "extra_high"] as const;
export type DraftGenerationReasoningEffort = (typeof DRAFT_GENERATION_EFFORTS)[number];

export type OpenAIReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export function coerceDraftGenerationModel(value: string | null | undefined): DraftGenerationModel {
  const cleaned = (value || "").trim();
  if ((DRAFT_GENERATION_MODELS as readonly string[]).includes(cleaned)) {
    return cleaned as DraftGenerationModel;
  }
  return "gpt-5.1";
}

function coerceStoredReasoningEffort(value: string | null | undefined): DraftGenerationReasoningEffort {
  const cleaned = (value || "").trim();
  if ((DRAFT_GENERATION_EFFORTS as readonly string[]).includes(cleaned)) {
    return cleaned as DraftGenerationReasoningEffort;
  }
  // Some older configs might have stored "xhigh" directly.
  if (cleaned === "xhigh") return "extra_high";
  return "medium";
}

export function coerceDraftGenerationReasoningEffort(opts: {
  model: DraftGenerationModel;
  storedValue: string | null | undefined;
}): { stored: DraftGenerationReasoningEffort; api: OpenAIReasoningEffort } {
  const stored = coerceStoredReasoningEffort(opts.storedValue);

  if (stored === "extra_high") {
    // extra_high (xhigh) is only supported on gpt-5.2
    if (opts.model === "gpt-5.2") return { stored, api: "xhigh" };
    return { stored: "high", api: "high" };
  }

  if (stored === "low") return { stored, api: "low" };
  if (stored === "high") return { stored, api: "high" };
  return { stored: "medium", api: "medium" };
}

// ---------------------------------------------------------------------------
// Structure Archetypes for Email Variation
// ---------------------------------------------------------------------------

export interface EmailDraftArchetype {
  id: string;
  name: string;
  instructions: string;
}

/**
 * EMAIL_DRAFT_STRUCTURE_ARCHETYPES
 *
 * 10 distinct structural patterns that force different email shapes.
 * The archetype is selected deterministically per draft attempt using a hash
 * of (leadId + triggerMessageId or timestamp).
 */
export const EMAIL_DRAFT_STRUCTURE_ARCHETYPES: EmailDraftArchetype[] = [
  {
    id: "A1_short_paragraph_bullets_question",
    name: "Short Paragraph + Bullets + Question",
    instructions: `Structure: One short opening paragraph (2-3 sentences max), then 2-3 bullet points highlighting value, end with a single question. Keep total length under 100 words.`,
  },
  {
    id: "A2_question_first_opener",
    name: "Question-First Opener",
    instructions: `Structure: Open with a direct question that relates to their situation. Follow with 2 sentences of context/value. Close with a soft call-to-action. No bullets.`,
  },
  {
    id: "A3_two_line_micro_story",
    name: "Two-Line Opener + Micro-Story",
    instructions: `Structure: Two-line opener (greeting + hook), then a brief micro-story (1-2 sentences about a similar situation/result), then invitation. Keep conversational.`,
  },
  {
    id: "A4_direct_scheduling_first",
    name: "Direct Scheduling Ask First",
    instructions: `Structure: Lead with the scheduling ask immediately after greeting. Then provide 1-2 sentences of context why. Include specific times if available. No fluff.`,
  },
  {
    id: "A5_empathy_bridge",
    name: "Empathy Bridge",
    instructions: `Structure: Open by acknowledging their situation/response. Bridge with "I thought..." or "That's why...". Close with a low-pressure next step. No bullets, conversational tone.`,
  },
  {
    id: "A6_single_paragraph_dense",
    name: "Single Dense Paragraph",
    instructions: `Structure: One cohesive paragraph (4-5 sentences). Pack value proposition, relevance to them, and call-to-action into a single flowing block. No line breaks.`,
  },
  {
    id: "A7_numbered_list_value",
    name: "Numbered List Value Prop",
    instructions: `Structure: Brief opener (1 sentence), then numbered list (1. 2. 3.) of specific benefits relevant to them, then closing question. Keep each number to one line.`,
  },
  {
    id: "A8_casual_ps_hook",
    name: "Casual with P.S. Hook",
    instructions: `Structure: Very brief main message (2-3 sentences, casual tone). Add a P.S. line with the key hook or scheduling link. The P.S. should be the most compelling part.`,
  },
  {
    id: "A9_comparison_contrast",
    name: "Before/After or Compare",
    instructions: `Structure: Open with a quick contrast (before vs after, or common approach vs better approach). 2 sentences max. Then bridge to how you help. Close with availability.`,
  },
  {
    id: "A10_social_proof_anchor",
    name: "Social Proof Anchor",
    instructions: `Structure: Open by referencing a relevant result or company (if available from context). Bridge to their situation. Close with scheduling. Keep proof specific, not generic.`,
  },
];

/**
 * Select an archetype deterministically based on a seed string.
 * Uses a simple hash to distribute evenly across archetypes.
 */
export function selectArchetypeFromSeed(seed: string): EmailDraftArchetype {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % EMAIL_DRAFT_STRUCTURE_ARCHETYPES.length;
  return EMAIL_DRAFT_STRUCTURE_ARCHETYPES[index];
}

/**
 * Build the seed for archetype selection.
 * - If triggerMessageId is present, use leadId:triggerMessageId (stable per message)
 * - Otherwise, use leadId:timestamp (varies per regeneration)
 */
export function buildArchetypeSeed(opts: {
  leadId: string;
  triggerMessageId: string | null | undefined;
  draftRequestStartedAtMs: number;
}): string {
  if (opts.triggerMessageId) {
    return `${opts.leadId}:${opts.triggerMessageId}`;
  }
  return `${opts.leadId}:${opts.draftRequestStartedAtMs}`;
}
