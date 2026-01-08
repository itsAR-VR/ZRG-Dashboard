import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { runResponse } from "@/lib/ai/openai-telemetry";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { getFirstRefusal, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { prisma } from "@/lib/prisma";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { formatAvailabilitySlots } from "@/lib/availability-format";
import { selectDistributedAvailabilitySlots } from "@/lib/availability-distribution";
import { getWorkspaceSlotOfferCountsForRange, incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import { isPositiveSentiment } from "@/lib/sentiment";

type DraftChannel = "sms" | "email" | "linkedin";

interface DraftGenerationResult {
  success: boolean;
  draftId?: string;
  content?: string;
  error?: string;
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

  return `You are ${opts.aiName}, a professional sales representative${opts.companyName ? ` from ${opts.companyName}` : ""}. Generate a brief SMS response (under 160 characters) based on the conversation context and sentiment.

${companyContext}${valueProposition}Tone: ${opts.aiTone}
Strategy: ${opts.responseStrategy}
Primary Goal/Strategy: ${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}
${serviceContext}${qualificationGuidance}${knowledgeSection}${availabilitySection}
Guidelines:
- Keep responses concise and SMS-friendly (under 160 characters)
- Be professional but personable
- Don't use emojis unless the lead used them first
- If proposing meeting times and availability is provided, offer 2 options from the list (verbatim) and ask which works; otherwise ask for their availability
- For objections, acknowledge and redirect professionally
- Never be pushy or aggressive
- If appropriate, naturally incorporate a qualification question
- When contextually appropriate, you may mention your company name naturally (don't force it into every message)
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
    "Follow Up",
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

/**
 * Generate an AI response draft based on conversation context and sentiment
 */
export async function generateResponseDraft(
  leadId: string,
  conversationTranscript: string,
  sentimentTag: string,
  channel: DraftChannel = "sms"
): Promise<DraftGenerationResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        firstName: true,
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
      "Follow Up",
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

    const systemPrompt =
      channel === "email"
        ? buildEmailPrompt({
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

    // GPT-5.1 with low reasoning effort for draft generation using Responses API
    const inputMessages =
      channel === "email"
        ? [
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
Generate an appropriate email response following the guidelines above.
</task>`,
          },
        ]
        : [
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

    const promptKey =
      channel === "email"
        ? "draft.generate.email.v1"
        : channel === "linkedin"
          ? "draft.generate.linkedin.v1"
          : "draft.generate.sms.v1";
    const promptTemplate = getAIPromptTemplate(promptKey);

    const timeoutMs = Math.max(
      10_000,
      Number.parseInt(process.env.OPENAI_DRAFT_TIMEOUT_MS || "120000", 10) || 120_000
    );

    const primaryModel = "gpt-5.1";
    const reasoningEffort = "low" as const;

    const budget = await computeAdaptiveMaxOutputTokens({
      model: primaryModel,
      instructions: systemPrompt,
      input: inputMessages,
      min: channel === "email" ? 500 : 160,
      max: channel === "email" ? 1100 : 360,
      overheadTokens: 256,
      outputScale: 0.2,
      preferApiCount: true,
    });

    let response: any;
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
          reasoning: { effort: reasoningEffort },
          max_output_tokens: budget.maxOutputTokens,
        },
        requestOptions: {
          timeout: timeoutMs,
          // Draft generation has its own fallback below.
          maxRetries: 0,
        },
      });
    } catch (error) {
      console.error("[AI Drafts] Primary draft generation failed:", error);
    }

    let draftContent = response ? getTrimmedOutputText(response)?.trim() : null;

    // Fallback: smaller model if the primary model failed or returned no output.
    if (!draftContent) {
      const fallbackModel = "gpt-5-mini";
      const fallbackBudget = await computeAdaptiveMaxOutputTokens({
        model: fallbackModel,
        instructions: systemPrompt,
        input: inputMessages,
        min: channel === "email" ? 300 : 120,
        max: channel === "email" ? 800 : 280,
        overheadTokens: 256,
        outputScale: 0.18,
        preferApiCount: true,
      });

      const fallback = await runResponse({
        clientId: lead.clientId,
        leadId,
        featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
        promptKey: `${promptTemplate?.key || promptKey}.fallback`,
        params: {
          model: fallbackModel,
          instructions: systemPrompt,
          input: inputMessages,
          reasoning: { effort: "low" },
          max_output_tokens: fallbackBudget.maxOutputTokens,
        },
        requestOptions: {
          timeout: timeoutMs,
          maxRetries: 0,
        },
      });

      draftContent = getTrimmedOutputText(fallback)?.trim() || null;
      response = fallback;
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

    const draft = await prisma.aIDraft.create({
      data: {
        leadId,
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
    "Follow Up": "Check in on their interest level. Reference any previous context and offer value.",
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
 * Excludes: Neutral (no engagement), Blacklist (opted out), Snoozed (temporarily hidden)
 */
export function shouldGenerateDraft(sentimentTag: string, email?: string | null): boolean {
  // Never generate drafts for bounce email addresses
  if (isBounceEmailAddress(email)) {
    return false;
  }

  // Only generate drafts for strictly positive sentiments.
  // (Legacy: "Positive" is treated as "Interested".)
  const normalized = sentimentTag === "Positive" ? "Interested" : sentimentTag;
  return isPositiveSentiment(normalized);
}
