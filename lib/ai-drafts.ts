import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { runResponse, runResponseWithInteraction, markAiInteractionError } from "@/lib/ai/openai-telemetry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { getFirstRefusal, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { prisma } from "@/lib/prisma";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { formatAvailabilitySlots } from "@/lib/availability-format";
import { selectDistributedAvailabilitySlots } from "@/lib/availability-distribution";
import { getWorkspaceSlotOfferCountsForRange, incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import { isPositiveSentiment } from "@/lib/sentiment";
import {
  coerceDraftGenerationModel,
  coerceDraftGenerationReasoningEffort,
  buildArchetypeSeed,
  selectArchetypeFromSeed,
  type EmailDraftArchetype,
} from "@/lib/ai-drafts/config";
import { getBookingProcessInstructions } from "@/lib/booking-process-instructions";

type DraftChannel = "sms" | "email" | "linkedin";

interface DraftGenerationResult {
  success: boolean;
  draftId?: string;
  content?: string;
  error?: string;
}

export type DraftGenerationOptions = {
  /**
   * Hard timeout for the OpenAI Responses request (ms).
   * Use a lower timeout in webhook contexts to avoid Vercel timeouts.
   */
  timeoutMs?: number;
  /**
   * Inbound Message.id that triggered this draft (idempotency key).
   * When provided, generateResponseDraft will return an existing draft for
   * (triggerMessageId, channel) instead of creating a duplicate.
   */
  triggerMessageId?: string | null;
  /**
   * Multiplier applied to the adaptive output token budget (min/max/overhead/outputScale).
   * Defaults to `OPENAI_DRAFT_TOKEN_BUDGET_MULTIPLIER` or 3.
   */
  tokenBudgetMultiplier?: number;
  /**
   * If true, attempts to call OpenAI's input-tokens count endpoint to size budgets.
   * Adds an extra request; consider disabling for latency-sensitive contexts.
   */
  preferApiCount?: boolean;
};

function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "P2002";
}

const EMAIL_FORBIDDEN_TERMS = [
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
  "It’s important to note/consider…",
  "It’s worth noting that…",
  "On the contrary…",
  "Deliver actionable insights through in-depth data analysis",
  "Drive insightful data-driven decisions",
  "Leveraging data-driven insights",
  "Leveraging complex datasets to extract meaningful insights",
  "Overly complex sentence structures",
  "An unusually formal tone in text that’s supposed to be conversational or casual",
  "An overly casual tone for a text that’s supposed to be formal or business casual",
  "Unnecessarily long and wordy",
  "Vague statements",
  "Note",
  "Your note",
  "Thanks for your note",
];

function buildSmsPrompt(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  responseStrategy: string;
  sentimentTag: string;
  aiGoals?: string | null;
  serviceDescription?: string | null;
  qualificationQuestions?: string[];
  knowledgeContext?: string;
  companyName?: string | null;
  targetResult?: string | null;
  availability?: string[];
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);

  // Build company context section
  const companyContext = opts.companyName
    ? `Company: ${opts.companyName}\n`
    : "";

  // Build value proposition context
  const valueProposition = opts.targetResult
    ? `Value Proposition: We help clients with ${opts.targetResult}\n`
    : "";

  // Build service context section
  const serviceContext = opts.serviceDescription
    ? `\nAbout Our Business:\n${opts.serviceDescription}\n`
    : "";

  // Build qualification guidance
  const qualificationGuidance = opts.qualificationQuestions && opts.qualificationQuestions.length > 0
    ? `\nQualification Questions to naturally weave into conversation when appropriate:\n${opts.qualificationQuestions.map(q => `- ${q}`).join("\n")}\n`
    : "";

  // Build knowledge context
  const knowledgeSection = opts.knowledgeContext
    ? `\nReference Information:\n${opts.knowledgeContext}\n`
    : "";

  const availabilitySection =
    opts.availability && opts.availability.length > 0
      ? `\nAvailable times (use verbatim if proposing times):\n${opts.availability.map((s) => `- ${s}`).join("\n")}\n`
      : "";

  return `You are ${opts.aiName}, a professional sales representative${opts.companyName ? ` from ${opts.companyName}` : ""}. Generate an SMS response based on the conversation context and sentiment.

OUTPUT FORMAT (strict):
- Prefer a single SMS part (<= 160 characters).
- If you cannot fit the required content in one part, output up to 3 SMS parts, each <= 160 characters.
- Separate parts with a line containing ONLY: ---
- Do NOT number the parts. Do NOT add any other labels or commentary.

${companyContext}${valueProposition}Tone: ${opts.aiTone}
Strategy: ${opts.responseStrategy}
Primary Goal/Strategy: ${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}
${serviceContext}${qualificationGuidance}${knowledgeSection}${availabilitySection}
Guidelines:
- Keep each SMS part <= 160 characters (hard limit). Total parts max 3.
- Be professional but personable
- Don't use emojis unless the lead used them first
- If proposing meeting times and availability is provided, offer 2 options from the list (verbatim) and ask which works; otherwise ask for their availability
- For objections, acknowledge and redirect professionally
- Never be pushy or aggressive
- If appropriate, naturally incorporate a qualification question
- When contextually appropriate, you may mention your company name naturally (don't force it into every message)
- Start with: ${greeting}`;
}

function buildLinkedInPrompt(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  responseStrategy: string;
  sentimentTag: string;
  aiGoals?: string | null;
  serviceDescription?: string | null;
  qualificationQuestions?: string[];
  knowledgeContext?: string;
  companyName?: string | null;
  targetResult?: string | null;
  availability?: string[];
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);

  const companyContext = opts.companyName ? `Company: ${opts.companyName}\n` : "";
  const valueProposition = opts.targetResult ? `Value Proposition: We help clients with ${opts.targetResult}\n` : "";
  const serviceContext = opts.serviceDescription ? `\nAbout Our Business:\n${opts.serviceDescription}\n` : "";

  const qualificationGuidance =
    opts.qualificationQuestions && opts.qualificationQuestions.length > 0
      ? `\nQualification Questions to naturally weave into the conversation when appropriate:\n${opts.qualificationQuestions
          .map((q) => `- ${q}`)
          .join("\n")}\n`
      : "";

  const knowledgeSection = opts.knowledgeContext ? `\nReference Information:\n${opts.knowledgeContext}\n` : "";

  const availabilitySection =
    opts.availability && opts.availability.length > 0
      ? `\nAvailable times (use verbatim if proposing times):\n${opts.availability.map((s) => `- ${s}`).join("\n")}\n`
      : "";

  return `You are ${opts.aiName}, a professional sales representative${opts.companyName ? ` from ${opts.companyName}` : ""}. Generate a concise LinkedIn message reply based on the conversation context and sentiment.

${companyContext}${valueProposition}Tone: ${opts.aiTone}
Strategy: ${opts.responseStrategy}
Primary Goal/Strategy: ${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}
${serviceContext}${qualificationGuidance}${knowledgeSection}${availabilitySection}

Guidelines:
- Output plain text only (no markdown).
- Keep it concise and natural (1-3 short paragraphs).
- Don't use emojis unless the lead used them first.
- If proposing meeting times and availability is provided, offer 2 options from the list (verbatim) and ask which works; otherwise ask for their availability.
- For objections, acknowledge and redirect professionally.
- Never be pushy or aggressive.
- Start with: ${greeting}`;
}

function buildEmailPrompt(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  responseStrategy: string;
  aiGoals?: string | null;
  availability: string[];
  sentimentTag: string;
  signature?: string | null;
  serviceDescription?: string | null;
  qualificationQuestions?: string[];
  knowledgeContext?: string;
  companyName?: string | null;
  targetResult?: string | null;
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);
  const shouldConsiderScheduling = [
    "Meeting Requested",
    "Call Requested",
    "Interested",
    "Positive",
    "Information Requested",
  ].includes(opts.sentimentTag);

  const availabilityBlock = shouldConsiderScheduling
    ? (opts.availability.length
      ? `If scheduling is the right next step, offer exactly 2 of these options (verbatim, keep in bullets):\n${opts.availability
        .map((slot) => `- ${slot}`)
        .join("\n")}`
      : "If scheduling is the right next step, propose that you'll send a couple time options (or ask for their availability).")
    : "Keep it short and helpful; only propose times if they asked.";

  const signature = opts.signature ? `\nSignature block to use:\n${opts.signature}` : "";

  // Build company context section
  const companyContext = opts.companyName
    ? `Company: ${opts.companyName}\n`
    : "";

  // Build value proposition context
  const valueProposition = opts.targetResult
    ? `Value Proposition: We help clients with ${opts.targetResult}\n`
    : "";

  // Build service context section
  const serviceContext = opts.serviceDescription
    ? `\nAbout Our Business:\n${opts.serviceDescription}\n`
    : "";

  // Build qualification guidance
  const qualificationGuidance = opts.qualificationQuestions && opts.qualificationQuestions.length > 0
    ? `\nQualification Questions to naturally weave into the email when appropriate:\n${opts.qualificationQuestions.map(q => `- ${q}`).join("\n")}\n`
    : "";

  // Build knowledge context
  const knowledgeSection = opts.knowledgeContext
    ? `\nReference Information (use when relevant to the conversation):\n${opts.knowledgeContext}\n`
    : "";

  return `You are an inbox manager writing replies for ${opts.aiName}${opts.companyName ? ` (${opts.companyName})` : ""}.

ROLE: inbox_manager
TASK: Reply to inbound lead responses from outreach, keep it focused, and move it toward a booked call when appropriate.

STYLE:
- Tone: ${opts.aiTone}
- Start with: ${greeting}
- Keep it concise and business-appropriate.

OUTPUT RULES:
- Do not include a subject line.
- Output the email reply in Markdown-friendly plain text (paragraphs and "-" bullets allowed).
- Do not use bold, italics, underline, strikethrough, code, or headings.
- Do not invent facts. Use only provided context.
- If the lead opted out/unsubscribed/asked to stop, output an empty reply ("") and nothing else.

SCHEDULING RULES:
${availabilityBlock}
- Never imply a meeting is booked unless the lead explicitly confirmed a specific time or said they booked/accepted an invite.
- A scheduling link in a signature must not affect your response unless the lead explicitly tells you to use it in the body.

COMPANY CONTEXT:
${companyContext}${valueProposition}

OFFER:
${opts.serviceDescription ? opts.serviceDescription : "No service description provided."}

GOALS/STRATEGY:
${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}

${qualificationGuidance}${knowledgeSection}

${signature ? "- Use the provided signature block below the closing.\n" + signature : ""}`;
}

// ---------------------------------------------------------------------------
// Two-Step Email Draft Generation (Phase 30)
// ---------------------------------------------------------------------------

/**
 * JSON schema for Step 1 strategy output (OpenAI Structured Outputs).
 * All keys are required per OpenAI spec - use null for "not present".
 */
const EMAIL_DRAFT_STRATEGY_JSON_SCHEMA = {
  type: "object",
  properties: {
    personalization_points: {
      type: "array",
      items: { type: "string" },
      description: "2-4 short personalization points specific to this lead (company, industry, previous conversation context)",
    },
    intent_summary: {
      type: "string",
      description: "One sentence summarizing the lead's intent and what the response should accomplish",
    },
    should_offer_times: {
      type: "boolean",
      description: "Whether to offer specific availability times in the response",
    },
    times_to_offer: {
      type: ["array", "null"],
      items: { type: "string" },
      description: "If should_offer_times is true, which specific times to offer (verbatim from availability list); null otherwise",
    },
    outline: {
      type: "array",
      items: { type: "string" },
      description: "3-5 bullet points describing the structure/flow of the email (what each section should accomplish)",
    },
    must_avoid: {
      type: "array",
      items: { type: "string" },
      description: "Any specific topics, tones, or approaches to avoid based on conversation context",
    },
  },
  required: ["personalization_points", "intent_summary", "should_offer_times", "times_to_offer", "outline", "must_avoid"],
  additionalProperties: false,
};

interface EmailDraftStrategy {
  personalization_points: string[];
  intent_summary: string;
  should_offer_times: boolean;
  times_to_offer: string[] | null;
  outline: string[];
  must_avoid: string[];
}

/**
 * Build the Step 1 (Strategy) system instructions.
 * Analyzes lead context and outputs a structured strategy JSON.
 */
function buildEmailDraftStrategyInstructions(opts: {
  aiName: string;
  aiTone: string;
  firstName: string;
  lastName: string | null;
  leadEmail: string | null;
  leadCompanyName: string | null;
  leadCompanyWebsite: string | null;
  leadCompanyState: string | null;
  leadIndustry: string | null;
  leadEmployeeHeadcount: string | null;
  leadLinkedinUrl: string | null;
  ourCompanyName: string | null;
  sentimentTag: string;
  responseStrategy: string;
  aiGoals: string | null;
  serviceDescription: string | null;
  qualificationQuestions: string[];
  knowledgeContext: string;
  availability: string[];
  archetype: EmailDraftArchetype;
}): string {
  const leadContext = [
    opts.firstName && `First Name: ${opts.firstName}`,
    opts.lastName && `Last Name: ${opts.lastName}`,
    opts.leadEmail && `Email: ${opts.leadEmail}`,
    opts.leadCompanyName && `Lead's Company: ${opts.leadCompanyName}`,
    opts.leadCompanyWebsite && `Website: ${opts.leadCompanyWebsite}`,
    opts.leadCompanyState && `State: ${opts.leadCompanyState}`,
    opts.leadIndustry && `Industry: ${opts.leadIndustry}`,
    opts.leadEmployeeHeadcount && `Company Size: ${opts.leadEmployeeHeadcount}`,
    opts.leadLinkedinUrl && `LinkedIn: ${opts.leadLinkedinUrl}`,
  ].filter(Boolean).join("\n");

  const availabilitySection = opts.availability.length > 0
    ? `\nAVAILABLE TIMES (use verbatim if scheduling):\n${opts.availability.map(s => `- ${s}`).join("\n")}`
    : "\nNo specific availability times provided.";

  const qualificationSection = opts.qualificationQuestions.length > 0
    ? `\nQUALIFICATION QUESTIONS to consider weaving in:\n${opts.qualificationQuestions.map(q => `- ${q}`).join("\n")}`
    : "";

  const knowledgeSection = opts.knowledgeContext
    ? `\nREFERENCE INFORMATION:\n${opts.knowledgeContext}`
    : "";

  return `You are analyzing a sales conversation to create a personalized response strategy.

CONTEXT:
- Responding as: ${opts.aiName}${opts.ourCompanyName ? ` (${opts.ourCompanyName})` : ""}
- Tone: ${opts.aiTone}
- Lead sentiment: ${opts.sentimentTag}
- Response approach: ${opts.responseStrategy}

LEAD INFORMATION:
${leadContext || "No additional lead information available."}

${opts.serviceDescription ? `OUR OFFER:\n${opts.serviceDescription}\n` : ""}
${opts.aiGoals ? `GOALS/STRATEGY:\n${opts.aiGoals}\n` : ""}
${qualificationSection}${knowledgeSection}${availabilitySection}

TARGET STRUCTURE ARCHETYPE: "${opts.archetype.name}"
${opts.archetype.instructions}

TASK:
Analyze this lead and conversation to produce a strategy for writing a personalized email response.
Output a JSON object with your analysis. Focus on:
1. What makes this lead unique (personalization_points)
2. What the response should achieve (intent_summary)
3. Whether to offer scheduling times (should_offer_times, times_to_offer)
4. The email structure (outline) - aligned with the archetype above
5. What to avoid (must_avoid)

Be specific and actionable. The strategy will be used to generate the actual email.`;
}

/**
 * Build the Step 2 (Generation) system instructions.
 * Uses strategy + archetype to generate varied email text.
 */
function buildEmailDraftGenerationInstructions(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  signature: string | null;
  ourCompanyName: string | null;
  sentimentTag: string;
  strategy: EmailDraftStrategy;
  archetype: EmailDraftArchetype;
}): string {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);

  const strategySection = `
PERSONALIZATION POINTS (use at least 2):
${opts.strategy.personalization_points.map(p => `- ${p}`).join("\n")}

INTENT: ${opts.strategy.intent_summary}

EMAIL STRUCTURE (follow this outline):
${opts.strategy.outline.map((o, i) => `${i + 1}. ${o}`).join("\n")}

${opts.strategy.should_offer_times && opts.strategy.times_to_offer?.length
    ? `OFFER THESE TIMES (verbatim):\n${opts.strategy.times_to_offer.map(t => `- ${t}`).join("\n")}`
    : opts.strategy.should_offer_times
      ? "SCHEDULING: Ask for their availability or propose to send times."
      : "SCHEDULING: Do not push for scheduling unless they specifically asked."}

MUST AVOID:
${opts.strategy.must_avoid.length > 0 ? opts.strategy.must_avoid.map(a => `- ${a}`).join("\n") : "- No specific avoidances identified."}`;

  const forbiddenTerms = EMAIL_FORBIDDEN_TERMS.slice(0, 30).join(", ");

  return `You are an inbox manager writing a reply for ${opts.aiName}${opts.ourCompanyName ? ` (${opts.ourCompanyName})` : ""}.

ROLE: inbox_manager
TASK: Write an email response following the provided strategy and structure.

STYLE:
- Tone: ${opts.aiTone}
- Start with: ${greeting}
- Keep it concise and business-appropriate.

STRUCTURE ARCHETYPE: "${opts.archetype.name}"
${opts.archetype.instructions}

${strategySection}

OUTPUT RULES:
- Do not include a subject line.
- Output the email reply in Markdown-friendly plain text (paragraphs and "-" bullets allowed).
- Do not use bold, italics, underline, strikethrough, code, or headings.
- Do not invent facts. Use only provided context.
- If the lead opted out/unsubscribed/asked to stop, output an empty reply ("") and nothing else.
- NEVER imply a meeting is booked unless the lead explicitly confirmed.

FORBIDDEN TERMS (never use):
${forbiddenTerms}

${opts.signature ? `SIGNATURE (include at end):\n${opts.signature}` : ""}

Write the email now, following the strategy and archetype structure exactly.`;
}

/**
 * Attempt to parse strategy JSON from response text.
 * Returns null on parse failure.
 */
function parseStrategyJson(text: string | null | undefined): EmailDraftStrategy | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    // Validate required fields exist
    if (
      Array.isArray(parsed.personalization_points) &&
      typeof parsed.intent_summary === "string" &&
      typeof parsed.should_offer_times === "boolean" &&
      Array.isArray(parsed.outline) &&
      Array.isArray(parsed.must_avoid)
    ) {
      return parsed as EmailDraftStrategy;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate an AI response draft based on conversation context and sentiment
 */
export async function generateResponseDraft(
  leadId: string,
  conversationTranscript: string,
  sentimentTag: string,
  channel: DraftChannel = "sms",
  opts: DraftGenerationOptions = {}
): Promise<DraftGenerationResult> {
  try {
    const triggerMessageId = typeof opts.triggerMessageId === "string" ? opts.triggerMessageId.trim() : null;

    if (triggerMessageId) {
      const existing = await prisma.aIDraft.findFirst({
        where: { triggerMessageId, channel },
        select: { id: true, content: true, leadId: true },
      });

      if (existing) {
        if (existing.leadId !== leadId) {
          console.warn(
            `[AI Drafts] triggerMessageId ${triggerMessageId} belongs to lead ${existing.leadId}, not ${leadId}`
          );
        }

        return { success: true, draftId: existing.id, content: existing.content };
      }
    }

    // Capture timestamp at start for archetype seed (stable within this request)
    const draftRequestStartedAtMs = Date.now();

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        companyWebsite: true,
        companyState: true,
        industry: true,
        employeeHeadcount: true,
        linkedinUrl: true,
        clientId: true,
        offeredSlots: true,
        snoozedUntil: true,
        client: {
          select: {
            name: true,
            settings: {
              include: {
                knowledgeAssets: {
                  select: {
                    name: true,
                    textContent: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const settings = lead?.client?.settings;
    const aiTone = settings?.aiTone || "friendly-professional";
    const aiName = settings?.aiPersonaName || lead?.client?.name || "Your Sales Rep";
    // Use channel-specific greeting with fallback chain:
    // SMS: aiSmsGreeting -> aiGreeting -> default
    // Email: aiGreeting -> default
    const defaultGreeting = "Hi {firstName},";
    const aiGreeting = channel === "sms"
      ? (settings?.aiSmsGreeting?.trim() || settings?.aiGreeting?.trim() || defaultGreeting)
      : (settings?.aiGreeting?.trim() || defaultGreeting);
    const aiGoals = settings?.aiGoals?.trim();
    const aiSignature = settings?.aiSignature?.trim();
    const serviceDescription = settings?.serviceDescription?.trim();
    // Company context - fallback to workspace name if not set
    const companyName = settings?.companyName?.trim() || lead?.client?.name || null;
    const targetResult = settings?.targetResult?.trim() || null;

    // Parse qualification questions from JSON
    let qualificationQuestions: string[] = [];
    if (settings?.qualificationQuestions) {
      try {
        const parsed = JSON.parse(settings.qualificationQuestions);
        qualificationQuestions = parsed.map((q: { question: string }) => q.question);
      } catch {
        // Ignore parse errors
      }
    }

    // Build knowledge context from assets (limit to avoid token overflow)
    let knowledgeContext = "";
    if (settings?.knowledgeAssets && settings.knowledgeAssets.length > 0) {
      const assetSnippets = settings.knowledgeAssets
        .filter(a => a.textContent)
        .slice(0, 3) // Limit to 3 most recent assets
        .map(a => `[${a.name}]: ${a.textContent!.slice(0, 1000)}${a.textContent!.length > 1000 ? "..." : ""}`);

      if (assetSnippets.length > 0) {
        knowledgeContext = assetSnippets.join("\n\n");
      }
    }

    const firstName = lead?.firstName || "there";
    const responseStrategy = getResponseStrategy(sentimentTag);
    const shouldConsiderScheduling = [
      "Meeting Requested",
      "Call Requested",
      "Interested",
      "Positive",
      "Information Requested",
    ].includes(sentimentTag);

    let availability: string[] = [];

    if (shouldConsiderScheduling && lead?.clientId) {
      try {
        const slots = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, { refreshIfStale: true });
        if (slots.slotsUtc.length > 0) {
          const offeredAtIso = new Date().toISOString();
          const offeredAt = new Date(offeredAtIso);
          const tzResult = await ensureLeadTimezone(leadId);
          const timeZone = tzResult.timezone || settings?.timezone || "UTC";
          const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";

          const existingOffered = new Set<string>();
          if (lead.offeredSlots) {
            try {
              const parsed = JSON.parse(lead.offeredSlots) as Array<{ datetime?: string }>;
              for (const s of parsed) {
                if (!s?.datetime) continue;
                const d = new Date(s.datetime);
                if (!Number.isNaN(d.getTime())) {
                  existingOffered.add(d.toISOString());
                }
              }
            } catch {
              // ignore parse errors
            }
          }

          const startAfterUtc =
            lead.snoozedUntil && lead.snoozedUntil > new Date() ? lead.snoozedUntil : null;

          const anchor = startAfterUtc && startAfterUtc > offeredAt ? startAfterUtc : offeredAt;
          const rangeEnd = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000);
          const offerCounts = await getWorkspaceSlotOfferCountsForRange(lead.clientId, anchor, rangeEnd);

          const selectedUtcIso = selectDistributedAvailabilitySlots({
            slotsUtcIso: slots.slotsUtc,
            offeredCountBySlotUtcIso: offerCounts,
            timeZone,
            excludeUtcIso: existingOffered,
            startAfterUtc,
            preferWithinDays: 5,
            now: offeredAt,
          });

          const formatted = formatAvailabilitySlots({
            slotsUtcIso: selectedUtcIso,
            timeZone,
            mode,
            limit: selectedUtcIso.length,
          });

          availability = formatted.map((s) => s.label);

          if (formatted.length > 0) {
            await prisma.lead.update({
              where: { id: leadId },
              data: {
                offeredSlots: JSON.stringify(
                  formatted.map((s) => ({
                    datetime: s.datetime,
                    label: s.label,
                    offeredAt: offeredAtIso,
                  }))
                ),
              },
            });

            await incrementWorkspaceSlotOffersBatch({
              clientId: lead.clientId,
              slotUtcIsoList: formatted.map((s) => s.datetime),
              offeredAt,
            });
          }
        }
      } catch (error) {
        console.error("[AI Drafts] Failed to load live availability:", error);
      }
    }

    // ---------------------------------------------------------------------------
    // Booking Process Instructions (Phase 36)
    // ---------------------------------------------------------------------------
    let bookingProcessInstructions: string | null = null;

    try {
      const bookingResult = await getBookingProcessInstructions({
        leadId,
        channel,
        workspaceSettings: settings,
        clientId: lead.clientId,
        availableSlots: availability, // Pass the already-loaded availability
      });

      if (bookingResult.requiresHumanReview) {
        console.log(
          `[AI Drafts] Lead ${leadId} requires human review: ${bookingResult.escalationReason}`
        );
        return {
          success: false,
          error: `Human review required: ${bookingResult.escalationReason}`,
        };
      }

      bookingProcessInstructions = bookingResult.instructions;

      if (bookingProcessInstructions) {
        console.log(
          `[AI Drafts] Using booking process stage ${bookingResult.stageNumber} (wave ${bookingResult.waveNumber}) for ${channel}`
        );
      }
    } catch (error) {
      console.error("[AI Drafts] Failed to get booking process instructions:", error);
      // Continue without booking instructions on error
    }

    // ---------------------------------------------------------------------------
    // Shared config
    // ---------------------------------------------------------------------------
    const envTimeoutMs = Number.parseInt(process.env.OPENAI_DRAFT_TIMEOUT_MS || "120000", 10) || 120_000;
    const timeoutMs = Math.max(5_000, opts.timeoutMs ?? envTimeoutMs);

    const envMultiplier = Number.parseFloat(process.env.OPENAI_DRAFT_TOKEN_BUDGET_MULTIPLIER || "3");
    const tokenBudgetMultiplier = Number.isFinite(opts.tokenBudgetMultiplier)
      ? Math.max(1, Math.min(10, opts.tokenBudgetMultiplier!))
      : Number.isFinite(envMultiplier)
        ? Math.max(1, Math.min(10, envMultiplier))
        : 3;

    const preferApiCount =
      typeof opts.preferApiCount === "boolean"
        ? opts.preferApiCount
        : (process.env.OPENAI_DRAFT_PREFER_API_TOKEN_COUNT ?? "false").toLowerCase() === "true";

    let draftContent: string | null = null;
    let response: any = null;

    // ---------------------------------------------------------------------------
    // Email: Two-Step Pipeline (Phase 30)
    // ---------------------------------------------------------------------------
    if (channel === "email") {
      // Coerce model/reasoning from workspace settings
      const draftModel = coerceDraftGenerationModel(settings?.draftGenerationModel);
      const { api: strategyReasoningApi } = coerceDraftGenerationReasoningEffort({
        model: draftModel,
        storedValue: settings?.draftGenerationReasoningEffort,
      });

      // Select archetype deterministically
      const archetypeSeed = buildArchetypeSeed({
        leadId,
        triggerMessageId,
        draftRequestStartedAtMs,
      });
      const archetype = selectArchetypeFromSeed(archetypeSeed);

      // Split timeout: ~40% for strategy, ~60% for generation
      const strategyTimeoutMs = Math.max(3000, Math.floor(timeoutMs * 0.4));
      const generationTimeoutMs = Math.max(3000, timeoutMs - strategyTimeoutMs);

      // Step 1: Strategy
      let strategy: EmailDraftStrategy | null = null;
      let strategyInteractionId: string | null = null;

      let strategyInstructions = buildEmailDraftStrategyInstructions({
        aiName,
        aiTone,
        firstName,
        lastName: lead.lastName,
        leadEmail: lead.email,
        leadCompanyName: lead.companyName,
        leadCompanyWebsite: lead.companyWebsite,
        leadCompanyState: lead.companyState,
        leadIndustry: lead.industry,
        leadEmployeeHeadcount: lead.employeeHeadcount,
        leadLinkedinUrl: lead.linkedinUrl,
        ourCompanyName: companyName,
        sentimentTag,
        responseStrategy,
        aiGoals: aiGoals || null,
        serviceDescription: serviceDescription || null,
        qualificationQuestions,
        knowledgeContext,
        availability,
        archetype,
      });

      // Append booking process instructions if available (Phase 36)
      if (bookingProcessInstructions) {
        strategyInstructions += bookingProcessInstructions;
      }

      const strategyInput = `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<lead_sentiment>${sentimentTag}</lead_sentiment>

<task>
Analyze this conversation and produce a JSON strategy for writing a personalized email response.
</task>`;

      try {
        const { response: strategyResponse, interactionId } = await runResponseWithInteraction({
          clientId: lead.clientId,
          leadId,
          featureId: "draft.generate.email.strategy",
          promptKey: `draft.generate.email.strategy.v1.arch_${archetype.id}`,
          params: {
            model: draftModel,
            instructions: strategyInstructions,
            input: [{ role: "user" as const, content: strategyInput }],
            reasoning: { effort: strategyReasoningApi },
            text: {
              format: {
                type: "json_schema",
                name: "email_draft_strategy",
                strict: true,
                schema: EMAIL_DRAFT_STRATEGY_JSON_SCHEMA,
              },
            },
            max_output_tokens: 1500, // Strategy should be compact
          },
          requestOptions: {
            timeout: strategyTimeoutMs,
            maxRetries: 0,
          },
        });

        strategyInteractionId = interactionId;
        const strategyText = getTrimmedOutputText(strategyResponse)?.trim();
        strategy = parseStrategyJson(strategyText);

        if (!strategy && strategyInteractionId) {
          await markAiInteractionError(strategyInteractionId, "strategy_parse_failed: Could not parse strategy JSON");
        }
      } catch (error) {
        console.error("[AI Drafts] Step 1 (Strategy) failed:", error);
      }

      // Step 2: Generation (if strategy succeeded)
      if (strategy) {
        const generationInstructions = buildEmailDraftGenerationInstructions({
          aiName,
          aiTone,
          aiGreeting,
          firstName,
          signature: aiSignature || null,
          ourCompanyName: companyName,
          sentimentTag,
          strategy,
          archetype,
        });

        const generationInput = `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<task>
Write the email response now, following the strategy and structure archetype.
</task>`;

        const generationBudget = await computeAdaptiveMaxOutputTokens({
          model: draftModel,
          instructions: generationInstructions,
          input: [{ role: "user" as const, content: generationInput }],
          min: Math.max(1, Math.floor(700 * tokenBudgetMultiplier)),
          max: Math.max(1, Math.floor(2400 * tokenBudgetMultiplier)),
          overheadTokens: 256 * tokenBudgetMultiplier,
          outputScale: 0.2 * tokenBudgetMultiplier,
          preferApiCount,
        });

        try {
          const generationResponse = await runResponse({
            clientId: lead.clientId,
            leadId,
            featureId: "draft.generate.email.generation",
            promptKey: `draft.generate.email.generation.v1.arch_${archetype.id}`,
            params: {
              model: draftModel,
              instructions: generationInstructions,
              input: [{ role: "user" as const, content: generationInput }],
              temperature: 0.95, // High temperature for variation
              // No reasoning for generation step - just output text
              max_output_tokens: generationBudget.maxOutputTokens,
            },
            requestOptions: {
              timeout: generationTimeoutMs,
              maxRetries: 0,
            },
          });

          draftContent = getTrimmedOutputText(generationResponse)?.trim() || null;
          response = generationResponse;
        } catch (error) {
          console.error("[AI Drafts] Step 2 (Generation) failed:", error);
        }
      }

      // Fallback: Single-step with archetype + high temperature (if two-step failed)
      if (!draftContent) {
        console.log("[AI Drafts] Two-step failed, falling back to single-step with archetype");

        let fallbackSystemPrompt = buildEmailPrompt({
          aiName,
          aiTone,
          aiGreeting,
          firstName,
          responseStrategy,
          aiGoals,
          availability,
          sentimentTag,
          signature: aiSignature,
          serviceDescription,
          qualificationQuestions,
          knowledgeContext,
          companyName,
          targetResult,
        }) + `\n\nSTRUCTURE REQUIREMENT: "${archetype.name}"\n${archetype.instructions}`;

        // Append booking process instructions if available (Phase 36)
        if (bookingProcessInstructions) {
          fallbackSystemPrompt += bookingProcessInstructions;
        }

        const fallbackInputMessages = [
          {
            role: "assistant" as const,
            content: `Completely avoid the usage of these words/phrases/tones:\n\n${EMAIL_FORBIDDEN_TERMS.join("\n")}`,
          },
          {
            role: "user" as const,
            content: `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<lead_sentiment>${sentimentTag}</lead_sentiment>

<task>
Generate an appropriate email response following the guidelines and structure archetype above.
</task>`,
          },
        ];

        const fallbackBudget = await computeAdaptiveMaxOutputTokens({
          model: draftModel,
          instructions: fallbackSystemPrompt,
          input: fallbackInputMessages,
          min: Math.max(1, Math.floor(900 * tokenBudgetMultiplier)),
          max: Math.max(1, Math.floor(3200 * tokenBudgetMultiplier)),
          overheadTokens: 256 * tokenBudgetMultiplier,
          outputScale: 0.18 * tokenBudgetMultiplier,
          preferApiCount,
        });

        try {
          const fallbackResponse = await runResponse({
            clientId: lead.clientId,
            leadId,
            featureId: "draft.generate.email",
            promptKey: `draft.generate.email.v1.fallback.arch_${archetype.id}`,
            params: {
              model: draftModel,
              instructions: fallbackSystemPrompt,
              input: fallbackInputMessages,
              temperature: 0.95,
              reasoning: { effort: strategyReasoningApi },
              max_output_tokens: fallbackBudget.maxOutputTokens,
            },
            requestOptions: {
              timeout: timeoutMs,
              maxRetries: 0,
            },
          });

          draftContent = getTrimmedOutputText(fallbackResponse)?.trim() || null;
          response = fallbackResponse;
        } catch (error) {
          console.error("[AI Drafts] Single-step fallback failed:", error);
        }
      }
    }
    // ---------------------------------------------------------------------------
    // SMS / LinkedIn: Single-step
    // ---------------------------------------------------------------------------
    else {
      let systemPrompt =
        channel === "linkedin"
          ? buildLinkedInPrompt({
              aiName,
              aiTone,
              aiGreeting,
              firstName,
              responseStrategy,
              sentimentTag,
              aiGoals,
              serviceDescription,
              qualificationQuestions,
              knowledgeContext,
              companyName,
              targetResult,
              availability,
            })
          : buildSmsPrompt({
              aiName,
              aiTone,
              aiGreeting,
              firstName,
              responseStrategy,
              sentimentTag,
              aiGoals,
              serviceDescription,
              qualificationQuestions,
              knowledgeContext,
              companyName,
              targetResult,
              availability,
            });

      // Append booking process instructions if available (Phase 36)
      if (bookingProcessInstructions) {
        systemPrompt += bookingProcessInstructions;
      }

      const inputMessages = [
        {
          role: "user" as const,
          content: `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<lead_sentiment>${sentimentTag}</lead_sentiment>

<task>
Generate an appropriate ${channel} response following the guidelines above.
</task>`,
        },
      ];

      const promptKey = channel === "linkedin" ? "draft.generate.linkedin.v1" : "draft.generate.sms.v1";
      const promptTemplate = getAIPromptTemplate(promptKey);

      const primaryModel = "gpt-5-mini";
      const reasoningEffort = "medium" as const;

      const primaryBudgetMin = 240 * tokenBudgetMultiplier;
      const primaryBudgetMax = 1200 * tokenBudgetMultiplier;

      const budget = await computeAdaptiveMaxOutputTokens({
        model: primaryModel,
        instructions: systemPrompt,
        input: inputMessages,
        min: Math.max(1, Math.floor(primaryBudgetMin)),
        max: Math.max(1, Math.floor(primaryBudgetMax)),
        overheadTokens: 256 * tokenBudgetMultiplier,
        outputScale: 0.2 * tokenBudgetMultiplier,
        preferApiCount,
      });

      try {
        response = await runResponse({
          clientId: lead.clientId,
          leadId,
          featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
          promptKey: promptTemplate?.key || promptKey,
          params: {
            model: primaryModel,
            instructions: systemPrompt,
            input: inputMessages,
            text: { verbosity: "low" },
            reasoning: { effort: reasoningEffort },
            max_output_tokens: budget.maxOutputTokens,
          },
          requestOptions: {
            timeout: timeoutMs,
            maxRetries: 0,
          },
        });
      } catch (error) {
        console.error("[AI Drafts] Primary SMS/LinkedIn generation failed:", error);
      }

      draftContent = response ? (getTrimmedOutputText(response)?.trim() || null) : null;

      // Retry once with more headroom if we hit the output token ceiling
      if (!draftContent && response?.incomplete_details?.reason === "max_output_tokens") {
        const cap = Math.max(800, Number.parseInt(process.env.OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP || "12000", 10) || 12_000);
        const retryMaxOutputTokens = Math.min(
          Math.max(budget.maxOutputTokens + 1000, Math.floor(budget.maxOutputTokens * 3)),
          cap
        );

        try {
          const retry = await runResponse({
            clientId: lead.clientId,
            leadId,
            featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
            promptKey: `${promptTemplate?.key || promptKey}.retry_more_tokens`,
            params: {
              model: primaryModel,
              instructions: systemPrompt,
              input: inputMessages,
              text: { verbosity: "low" },
              reasoning: { effort: reasoningEffort },
              max_output_tokens: retryMaxOutputTokens,
            },
            requestOptions: {
              timeout: timeoutMs,
              maxRetries: 0,
            },
          });

          draftContent = getTrimmedOutputText(retry)?.trim() || null;
          response = retry;
        } catch (error) {
          console.error("[AI Drafts] Retry after max_output_tokens failed:", error);
        }
      }

      // Fallback: same model, spend more tokens
      if (!draftContent) {
        const fallbackBudgetMin = 320 * tokenBudgetMultiplier;
        const fallbackBudgetMax = 1600 * tokenBudgetMultiplier;

        const fallbackBudget = await computeAdaptiveMaxOutputTokens({
          model: primaryModel,
          instructions: systemPrompt,
          input: inputMessages,
          min: Math.max(1, Math.floor(fallbackBudgetMin)),
          max: Math.max(1, Math.floor(fallbackBudgetMax)),
          overheadTokens: 256 * tokenBudgetMultiplier,
          outputScale: 0.18 * tokenBudgetMultiplier,
          preferApiCount,
        });

        try {
          const fallback = await runResponse({
            clientId: lead.clientId,
            leadId,
            featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
            promptKey: `${promptTemplate?.key || promptKey}.fallback`,
            params: {
              model: primaryModel,
              instructions: systemPrompt,
              input: inputMessages,
              text: { verbosity: "low" },
              reasoning: { effort: reasoningEffort },
              max_output_tokens: fallbackBudget.maxOutputTokens,
            },
            requestOptions: {
              timeout: timeoutMs,
              maxRetries: 0,
            },
          });

          draftContent = getTrimmedOutputText(fallback)?.trim() || null;
          response = fallback;
        } catch (error) {
          console.error("[AI Drafts] SMS/LinkedIn fallback failed:", error);
        }
      }
    }

    if (!draftContent) {
      const refusal = response ? getFirstRefusal(response) : null;
      const details = response ? summarizeResponseForTelemetry(response) : null;
      return {
        success: false,
        error: refusal
          ? `AI refused to generate a draft (${refusal.slice(0, 180)})`
          : `Failed to generate draft content${details ? ` (${details})` : ""}`,
      };
    }

    try {
      const draft = await prisma.aIDraft.create({
        data: {
          leadId,
          triggerMessageId: triggerMessageId || undefined,
          content: draftContent,
          status: "pending",
          channel,
        },
      });

      return {
        success: true,
        draftId: draft.id,
        content: draftContent,
      };
    } catch (error) {
      // If multiple workers raced, return the already-created draft instead of failing.
      if (triggerMessageId && isPrismaUniqueConstraintError(error)) {
        const existing = await prisma.aIDraft.findFirst({
          where: { triggerMessageId, channel },
          select: { id: true, content: true },
        });
        if (existing) {
          return { success: true, draftId: existing.id, content: existing.content };
        }
      }

      throw error;
    }
  } catch (error) {
    console.error("Failed to generate AI draft:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function getResponseStrategy(sentimentTag: string): string {
  const strategies: Record<string, string> = {
    "Meeting Requested": "Confirm interest and propose specific meeting times. Be enthusiastic but professional.",
    "Call Requested": "Acknowledge their request for a call. Confirm the best number to reach them and propose specific call times.",
    "Not Interested": "Acknowledge their decision respectfully. Ask if they'd like to be contacted in the future or if there's anything specific they're looking for.",
    "Information Requested": "Provide the requested information clearly and concisely. Offer to schedule a call for more details.",
    "Follow Up":
      "Acknowledge the timing and keep it low-pressure. Ask a single timeline question (e.g., 6–12 months, 1–2 years, later) and if it’s okay to check back then. Don’t push for a meeting.",
    "Out of Office": "Acknowledge and ask when would be a good time to reconnect. Be understanding.",
    "Automated Reply": "DO NOT GENERATE A RESPONSE - This is an automated acknowledgement.",
    "Interested": "Build on the positive momentum. Move towards scheduling a conversation or next steps.",
    "Positive": "Build on the positive momentum. Move towards scheduling a conversation or next steps.", // Legacy fallback
    "Blacklist": "DO NOT GENERATE A RESPONSE - This contact has opted out.",
  };

  return strategies[sentimentTag] || "Respond professionally and try to move the conversation forward.";
}

/**
 * Check if an email address is a bounce notification sender
 * (mailer-daemon, postmaster, etc.) - should never get AI drafts
 */
export function isBounceEmailAddress(email: string | null | undefined): boolean {
  if (!email) return false;
  const lowerEmail = email.toLowerCase();
  return (
    lowerEmail.includes("mailer-daemon") ||
    lowerEmail.includes("postmaster") ||
    lowerEmail.includes("mail-delivery") ||
    lowerEmail.includes("maildelivery") ||
    (lowerEmail.includes("noreply") && lowerEmail.includes("google")) ||
    lowerEmail.startsWith("bounce") ||
    lowerEmail.includes("mail delivery subsystem")
  );
}

/**
 * Determine if an AI draft should be generated for a lead.
 * Uses a whitelist approach - only generate drafts for leads who have engaged.
 * 
 * Includes: positive intents + Follow Up deferrals
 */
export function shouldGenerateDraft(sentimentTag: string, email?: string | null): boolean {
  // Never generate drafts for bounce email addresses
  if (isBounceEmailAddress(email)) {
    return false;
  }

  // Generate drafts for positive intents, plus "Follow Up" (deferrals / not-now timing).
  // (Legacy: "Positive" is treated as "Interested".)
  const normalized = sentimentTag === "Positive" ? "Interested" : sentimentTag;
  return normalized === "Follow Up" || isPositiveSentiment(normalized);
}
