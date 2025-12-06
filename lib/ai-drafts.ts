import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type DraftChannel = "sms" | "email";

interface DraftGenerationResult {
  success: boolean;
  draftId?: string;
  content?: string;
  error?: string;
}

const EMAIL_FORBIDDEN_TERMS = ["tailored", "surface", "actionable", "synergy", "circle back"];

function parseTimePart(value?: string, fallback = "00:00") {
  const [hours, minutes] = (value || fallback).split(":").map((p) => parseInt(p, 10));
  return { hours: Number.isFinite(hours) ? hours : 0, minutes: Number.isFinite(minutes) ? minutes : 0 };
}

function formatInTimezone(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
}

function getAvailabilitySlots(settings?: {
  timezone?: string | null;
  workStartTime?: string | null;
  workEndTime?: string | null;
}): string[] {
  const timezone = settings?.timezone || "UTC";
  const { hours: startH, minutes: startM } = parseTimePart(settings?.workStartTime ?? undefined, "09:00");
  const { hours: endH, minutes: endM } = parseTimePart(settings?.workEndTime ?? undefined, "17:00");

  const slots: string[] = [];
  const cursor = new Date();

  while (slots.length < 3) {
    cursor.setDate(cursor.getDate() + 1);

    const localDate = new Date(cursor.toLocaleString("en-US", { timeZone: timezone }));
    const day = localDate.getDay(); // 0 = Sun, 6 = Sat
    if (day === 0 || day === 6) continue;

    const start = new Date(localDate);
    start.setHours(startH, startM, 0, 0);
    const end = new Date(localDate);
    end.setHours(endH, endM, 0, 0);

    const dayPart = formatInTimezone(start, timezone, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const startPart = formatInTimezone(start, timezone, { hour: "numeric", minute: "2-digit" });
    const endPart = formatInTimezone(end, timezone, { hour: "numeric", minute: "2-digit" });

    slots.push(`${dayPart} · ${startPart} - ${endPart} (${timezone})`);
  }

  return slots;
}

function buildSmsPrompt(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  responseStrategy: string;
  aiGoals?: string | null;
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);
  return `You are ${opts.aiName}, a professional sales representative. Generate a brief SMS response (under 160 characters) based on the conversation context and sentiment.

Tone: ${opts.aiTone}
Strategy: ${opts.responseStrategy}
Primary Goal/Strategy: ${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}

Guidelines:
- Keep responses concise and SMS-friendly (under 160 characters)
- Be professional but personable
- Don't use emojis unless the lead used them first
- For meeting requests, offer specific times or ask for their availability
- For objections, acknowledge and redirect professionally
- Never be pushy or aggressive
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
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);
  const availabilityBlock =
    opts.sentimentTag === "Meeting Requested" || opts.sentimentTag === "Call Requested"
      ? (opts.availability.length
        ? `Offer one of these options (keep in bullets):\n${opts.availability
          .map((slot) => `- ${slot}`)
          .join("\n")}`
        : "Offer to propose a few time options and keep it concise.")
      : opts.sentimentTag === "Meeting Booked"
        ? "Do not propose times; confirm the booking and next steps."
        : "Keep it short and helpful; only propose times if they asked.";

  const banned = EMAIL_FORBIDDEN_TERMS.map((w) => `"${w}"`).join(", ");
  const signature = opts.signature ? `\nSignature block to use:\n${opts.signature}` : "";

  return `You are ${opts.aiName}, a professional sales representative responding by email.

Tone: ${opts.aiTone}
Strategy: ${opts.responseStrategy}
Primary Goal/Strategy: ${opts.aiGoals || "Advance the conversation while respecting user intent."}

Email constraints:
- 120-220 words, clear paragraphs, no fluff.
- Start with: ${greeting}
- Avoid these words/phrases: ${banned}
- Keep subject/previous context consistent; do not invent new topics.
- Be concise, decisive, and respectful.
- ${availabilityBlock}
- For objections, acknowledge then redirect with value.
- For "Meeting Booked", send a short confirmation and any prep steps; no scheduling requests.
- Close politely. Include signature if provided.
${signature ? "- Use the provided signature below the closing.\n" + signature : ""}`;
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
        firstName: true,
        client: {
          select: {
            name: true,
            settings: true,
          },
        },
      },
    });

    const settings = lead?.client?.settings;
    const aiTone = settings?.aiTone || "friendly-professional";
    const aiName = settings?.aiPersonaName || lead?.client?.name || "Your Sales Rep";
    const aiGreeting = settings?.aiGreeting || (channel === "email" ? "Hi {firstName}," : "Hi {firstName},");
    const aiGoals = settings?.aiGoals?.trim();
    const aiSignature = settings?.aiSignature?.trim();

    const firstName = lead?.firstName || "there";
    const responseStrategy = getResponseStrategy(sentimentTag);
    const availability = channel === "email" ? getAvailabilitySlots(settings || undefined) : [];

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
        })
        : buildSmsPrompt({
          aiName,
          aiTone,
          aiGreeting,
          firstName,
          responseStrategy,
          aiGoals,
        });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Conversation transcript:\n${conversationTranscript}\n\nLead sentiment: ${sentimentTag}\n\nGenerate an appropriate ${channel === "email" ? "email" : "SMS"
            } response:`,
        },
      ],
      temperature: channel === "email" ? 0.6 : 0.7,
      max_tokens: channel === "email" ? 320 : 100,
    });

    const draftContent = completion.choices[0]?.message?.content?.trim();

    if (!draftContent) {
      return { success: false, error: "Failed to generate draft content" };
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
    "Positive": "Build on the positive momentum. Move towards scheduling a conversation or next steps.",
    "Neutral": "Engage with a question or valuable insight to spark interest.",
    "Blacklist": "DO NOT GENERATE A RESPONSE - This contact has opted out.",
  };

  return strategies[sentimentTag] || "Respond professionally and try to move the conversation forward.";
}

export function shouldGenerateDraft(sentimentTag: string): boolean {
  const noResponseSentiments = ["Blacklist"];
  return !noResponseSentiments.includes(sentimentTag);
}

