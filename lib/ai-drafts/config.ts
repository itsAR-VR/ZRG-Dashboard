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

export const EMAIL_DRAFT_VERIFICATION_MODELS = ["gpt-5-mini", "gpt-5.1", "gpt-5.2"] as const;
export type EmailDraftVerificationModel = (typeof EMAIL_DRAFT_VERIFICATION_MODELS)[number];

export function coerceEmailDraftVerificationModel(value: string | null | undefined): EmailDraftVerificationModel {
  const cleaned = (value || "").trim();
  if ((EMAIL_DRAFT_VERIFICATION_MODELS as readonly string[]).includes(cleaned)) {
    return cleaned as EmailDraftVerificationModel;
  }
  return "gpt-5.2";
}

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
  /** Psychology-based guidance for when this archetype is most effective */
  psychology: string;
}

/**
 * EMAIL_DRAFT_STRUCTURE_ARCHETYPES
 *
 * 10 distinct structural patterns that force different email shapes.
 * Each includes psychology-based guidance for intelligent selection.
 *
 * For initial drafts: AI analyzes context and selects best-fit archetype.
 * For regeneration: Random selection cycles through different structures.
 */
export const EMAIL_DRAFT_STRUCTURE_ARCHETYPES: EmailDraftArchetype[] = [
  {
    id: "A1_short_paragraph_bullets_question",
    name: "Short Paragraph + Bullets + Question",
    instructions: `Structure: One short opening paragraph (2-3 sentences max), then 2-3 bullet points highlighting value, end with a single question. Keep total length under 100 words.`,
    psychology: `Best for: Busy executives, analytical decision-makers, or leads who asked for information. The bullets leverage the "chunking" principle (easier cognitive processing) and the closing question uses the "commitment/consistency" principle to encourage response. Use when lead seems time-pressed or requested specific details.`,
  },
  {
    id: "A2_question_first_opener",
    name: "Question-First Opener",
    instructions: `Structure: Open with a direct question that relates to their situation. Follow with 2 sentences of context/value. Close with a soft call-to-action. No bullets.`,
    psychology: `Best for: Re-engaging quiet leads or when you need to spark curiosity. Opening with a question triggers the "open loop" effect (Zeigarnik effect) - the brain wants to resolve unanswered questions. Most effective when the lead has gone quiet or when their previous response was brief/ambiguous.`,
  },
  {
    id: "A3_two_line_micro_story",
    name: "Two-Line Opener + Micro-Story",
    instructions: `Structure: Two-line opener (greeting + hook), then a brief micro-story (1-2 sentences about a similar situation/result), then invitation. Keep conversational.`,
    psychology: `Best for: Building rapport with skeptical or relationship-oriented leads. Stories activate neural coupling (mirror neurons) and are 22x more memorable than facts alone. Use when the lead seems hesitant, asked about results, or when building trust is more important than speed.`,
  },
  {
    id: "A4_direct_scheduling_first",
    name: "Direct Scheduling Ask First",
    instructions: `Structure: Lead with the scheduling ask immediately after greeting. Then provide 1-2 sentences of context why. Include specific times if available. No fluff.`,
    psychology: `Best for: Highly interested leads who have already expressed intent (Meeting Requested, Call Requested). Leverages "foot in the door" and reduces decision fatigue by making the next step crystal clear. Use when sentiment is positive and they've already shown buying signals.`,
  },
  {
    id: "A5_empathy_bridge",
    name: "Empathy Bridge",
    instructions: `Structure: Open by acknowledging their situation/response. Bridge with "I thought..." or "That's why...". Close with a low-pressure next step. No bullets, conversational tone.`,
    psychology: `Best for: Leads who expressed concerns, objections, or timing issues (Follow Up, Out of Office returns). Acknowledgment builds psychological safety and reduces resistance. The bridge reframes without being pushy. Use when they've raised an objection or seem uncertain.`,
  },
  {
    id: "A6_single_paragraph_dense",
    name: "Single Dense Paragraph",
    instructions: `Structure: One cohesive paragraph (4-5 sentences). Pack value proposition, relevance to them, and call-to-action into a single flowing block. No line breaks.`,
    psychology: `Best for: Mobile readers or when you have one compelling point to make. Single-block text feels more personal/human (like a quick note). Avoid for complex topics. Use when the message is simple, the lead reads on mobile, or when a conversational tone matches their style.`,
  },
  {
    id: "A7_numbered_list_value",
    name: "Numbered List Value Prop",
    instructions: `Structure: Brief opener (1 sentence), then numbered list (1. 2. 3.) of specific benefits relevant to them, then closing question. Keep each number to one line.`,
    psychology: `Best for: Logical decision-makers or when overcoming the "what's in it for me" barrier. Numbers create perceived structure and credibility. The "rule of three" is cognitively satisfying. Use when lead asked about benefits, or when dealing with someone who seems data-driven/analytical.`,
  },
  {
    id: "A8_casual_ps_hook",
    name: "Casual with P.S. Hook",
    instructions: `Structure: Very brief main message (2-3 sentences, casual tone). Add a P.S. line with the key hook or scheduling link. The P.S. should be the most compelling part.`,
    psychology: `Best for: Standing out in a crowded inbox or with leads who respond to personality. P.S. lines have 79% higher readership (primacy-recency effect). The casual tone builds likability. Use when lead's tone was informal, when previous formal approaches failed, or when differentiation matters.`,
  },
  {
    id: "A9_comparison_contrast",
    name: "Before/After or Compare",
    instructions: `Structure: Open with a quick contrast (before vs after, or common approach vs better approach). 2 sentences max. Then bridge to how you help. Close with availability.`,
    psychology: `Best for: Leads who are evaluating options or stuck in status quo. Contrast creates clarity and highlights the gap between current state and desired state. Leverages "loss aversion" (what they're missing). Use when lead mentioned competitors, current challenges, or seems to be comparing solutions.`,
  },
  {
    id: "A10_social_proof_anchor",
    name: "Social Proof Anchor",
    instructions: `Structure: Open by referencing a relevant result or company (if available from context). Bridge to their situation. Close with scheduling. Keep proof specific, not generic.`,
    psychology: `Best for: Risk-averse leads or enterprise buyers who need validation. Social proof reduces perceived risk by leveraging "consensus" principle (others like me did this). Most effective when you have relevant case studies, industry matches, or the lead seems hesitant about making a decision.`,
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

/**
 * Find an archetype by ID.
 * Returns undefined if not found.
 */
export function getArchetypeById(id: string): EmailDraftArchetype | undefined {
  return EMAIL_DRAFT_STRUCTURE_ARCHETYPES.find((a) => a.id === id);
}

/**
 * Build the archetype selection guide for AI to choose the best-fit archetype.
 * Used in the Strategy step when AI should select archetype based on context.
 */
export function buildArchetypeSelectionGuide(): string {
  const archetypeDescriptions = EMAIL_DRAFT_STRUCTURE_ARCHETYPES.map((a) => {
    return `**${a.id}** - "${a.name}"
Psychology: ${a.psychology}`;
  }).join("\n\n");

  return `ARCHETYPE SELECTION GUIDE
========================
Based on the conversation context, lead sentiment, and psychological principles below, select the most effective email structure archetype.

${archetypeDescriptions}

SELECTION PRINCIPLES:
1. Match archetype to lead's communication style (formal → structured archetypes; casual → conversational ones)
2. Consider their sentiment/intent (Meeting Requested → A4 Direct; objections → A5 Empathy Bridge)
3. Factor in industry/role (executives → concise A1/A4; technical → detailed A7)
4. Account for conversation history (been quiet → A2 Question; multiple exchanges → A8 Casual)
5. When uncertain, A1 (Short Paragraph + Bullets + Question) is a safe, versatile default`
}
