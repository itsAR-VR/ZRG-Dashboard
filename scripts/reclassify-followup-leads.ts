/**
 * Re-classify all leads currently tagged as "Follow Up"
 * Applies the new pre-classification logic and AI classification.
 * 
 * Run with: npx tsx scripts/reclassify-followup-leads.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import OpenAI from "openai";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Sentiment tags (without "Positive" - consolidated into "Interested")
const SENTIMENT_TAGS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Not Interested",
  "Blacklist",
  "Follow Up",
  "Out of Office",
  "Interested",
  "Neutral",
  "Snoozed",
] as const;

type SentimentTag = (typeof SENTIMENT_TAGS)[number];

const SENTIMENT_TO_STATUS: Record<SentimentTag, string> = {
  "Meeting Requested": "meeting-requested",
  "Call Requested": "qualified",
  "Information Requested": "qualified",
  "Not Interested": "not-interested",
  "Blacklist": "blacklisted",
  "Follow Up": "new",
  "Out of Office": "new",
  "Interested": "qualified",
  "Neutral": "new",
  "Snoozed": "new",
};

/**
 * Pre-classification check - returns sentiment if determinable without AI
 * Only auto-classifies leads who have NEVER responded.
 * If lead has responded at any point, always use AI classification.
 */
function preClassifySentiment(
  messages: { direction: string }[]
): SentimentTag | null {
  if (messages.length === 0) {
    return "Neutral";
  }

  // Only auto-classify if lead has NEVER responded
  const hasInboundMessages = messages.some((m) => m.direction === "inbound");
  if (!hasInboundMessages) {
    return "Neutral";
  }

  // Lead has responded - always use AI classification
  return null;
}

/**
 * AI classification with improved prompt
 */
async function classifySentiment(transcript: string): Promise<SentimentTag> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  try {
    const response = await openai.responses.create({
      model: "gpt-5-mini",
      instructions: `<task>
You are a sales conversation classifier. Analyze the conversation transcript and classify it into ONE category based on the LEAD's responses (not the Agent's messages).
</task>

<categories>
- "Meeting Requested" - Lead explicitly asks for or confirms a meeting/video call time
- "Call Requested" - Lead provides a phone number or explicitly asks to be called
- "Information Requested" - Lead asks questions or requests details about:
  * General info: "tell me more", "what do you have?", "let's talk", "let's connect"
  * Pricing/value: "how much?", "what does it cost?", "what's it worth?", "what's X go for?"
  * Business inquiries: "what are you offering?", "what's the deal?", "what do you have in mind?"
  * Process/timeline: "how does it work?", "what's the process?", "how long does it take?"
- "Not Interested" - Lead explicitly declines or says no to further contact
- "Blacklist" - Lead is hostile, demands removal, threatens legal action, or uses profanity
- "Follow Up" - Lead responded but deferred action ("I'm busy right now", "contact me later", "not right now", "let me think about it", "I'll get back to you") OR gave a simple acknowledgment without commitment ("ok", "thanks", "got it")
- "Out of Office" - Lead mentions being on vacation, traveling, or temporarily unavailable
- "Interested" - Lead shows clear interest or openness ("sure", "sounds good", "I'm interested", "yes", "okay let's do it", "listening to offers", "open to suggestions")
- "Neutral" - Lead's response is genuinely ambiguous with no clear intent (this should be RARE)
</categories>

<classification_rules>
CRITICAL RULES:
1. ANY question from the lead = engagement signal. Questions about pricing, value, cost, process, timeline, or what you're offering → "Information Requested"
2. Curious questions like "what's X go for?", "what do you have in mind?", "how much for X?" → "Information Requested"
3. "Follow Up" is ONLY for leads who responded with deferrals ("busy", "later", "not now") or simple acknowledgments ("ok", "thanks")
4. Affirmative responses like "sure", "sounds good", "yes", "I'm interested" → "Interested"
5. Only use "Neutral" when the response is truly ambiguous with zero intent signals (this is rare - most responses have some intent)
6. Only use "Not Interested" for clear rejections ("no", "not interested", "don't contact me")
7. Only use "Blacklist" for explicit hostility, profanity, or opt-out demands
8. When in doubt between "Information Requested" and "Neutral", prefer "Information Requested" - questions show engagement
</classification_rules>

<output_format>
Respond with ONLY the category name, nothing else.
</output_format>`,
      input: `<conversation>
${transcript}
</conversation>`,
      reasoning: { effort: "low" },
      max_output_tokens: 50,
    });

    const raw = response.output_text?.trim() || "";
    const cleaned = raw.replace(/^[\"'`]+|[\"'`]+$/g, "").replace(/\.$/, "").trim();

    if (cleaned === "Positive") return "Interested";

    const exact = SENTIMENT_TAGS.find((tag) => tag.toLowerCase() === cleaned.toLowerCase());
    if (exact) return exact;

    const contained = SENTIMENT_TAGS.find((tag) => cleaned.toLowerCase().includes(tag.toLowerCase()));
    if (contained) return contained;

    return "Neutral";
  } catch (error) {
    console.error("[Sentiment] Classification error:", error);
    return "Neutral";
  }
}

async function main() {
  console.log('🔄 Re-classifying all "Follow Up" leads...\n');

  // Get all leads with "Follow Up" sentiment
  const followUpLeads = await prisma.lead.findMany({
    where: { sentimentTag: "Follow Up" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      sentimentTag: true,
      client: { select: { name: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          body: true,
          direction: true,
          sentAt: true,
        },
      },
    },
  });

  console.log(`📊 Found ${followUpLeads.length} leads with "Follow Up" tag\n`);

  let processed = 0;
  let changed = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;

  const changes: { name: string; workspace: string; from: string; to: string }[] = [];

  // Process in batches
  const BATCH_SIZE = 5;
  const DELAY_BETWEEN_BATCHES = 1000;

  for (let i = 0; i < followUpLeads.length; i += BATCH_SIZE) {
    const batch = followUpLeads.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (lead) => {
        const leadName =
          [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
          lead.email ||
          "Unknown";

        if (lead.messages.length === 0) {
          console.log(`⏭️  [${lead.client.name}] ${leadName}: No messages, skipping`);
          return { skipped: true };
        }

        try {
          // First try pre-classification
          const preClassified = preClassifySentiment(lead.messages);

          let newSentiment: SentimentTag;

          if (preClassified !== null) {
            newSentiment = preClassified;
            console.log(
              `📋 [${lead.client.name}] ${leadName}: Pre-classified → ${newSentiment}`
            );
          } else {
            // Need AI classification
            const transcript = lead.messages
              .map(
                (m) =>
                  `${m.direction === "inbound" ? "Lead" : "Agent"}: ${m.body}`
              )
              .join("\n");

            newSentiment = await classifySentiment(transcript);
          }

          const newStatus = SENTIMENT_TO_STATUS[newSentiment] || "new";
          const sentimentChanged = newSentiment !== lead.sentimentTag;

          if (sentimentChanged) {
            await prisma.lead.update({
              where: { id: lead.id },
              data: {
                sentimentTag: newSentiment,
                status: newStatus,
              },
            });

            changes.push({
              name: leadName,
              workspace: lead.client.name,
              from: lead.sentimentTag || "null",
              to: newSentiment,
            });

            console.log(
              `✅ [${lead.client.name}] ${leadName}: Follow Up → ${newSentiment}`
            );
            return { changed: true };
          } else {
            console.log(
              `➖ [${lead.client.name}] ${leadName}: Unchanged (Follow Up)`
            );
            return { unchanged: true };
          }
        } catch (error) {
          console.error(`❌ [${lead.client.name}] ${leadName}: Error -`, error);
          return { error: true };
        }
      })
    );

    // Count results
    for (const result of results) {
      processed++;
      if (result.status === "fulfilled") {
        if (result.value.skipped) skipped++;
        else if (result.value.changed) changed++;
        else if (result.value.unchanged) unchanged++;
        else if (result.value.error) errors++;
      } else {
        errors++;
      }
    }

    // Progress update
    const progress = Math.round((processed / followUpLeads.length) * 100);
    console.log(`\n📈 Progress: ${processed}/${followUpLeads.length} (${progress}%)\n`);

    // Delay between batches
    if (i + BATCH_SIZE < followUpLeads.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✨ Follow Up re-classification complete!");
  console.log("=".repeat(60));
  console.log(`📊 Total leads: ${followUpLeads.length}`);
  console.log(`✅ Changed: ${changed}`);
  console.log(`➖ Unchanged: ${unchanged}`);
  console.log(`⏭️  Skipped (no messages): ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log("=".repeat(60));

  if (changes.length > 0) {
    console.log("\n📝 Changes made:");
    for (const change of changes) {
      console.log(`   [${change.workspace}] ${change.name}: ${change.from} → ${change.to}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
