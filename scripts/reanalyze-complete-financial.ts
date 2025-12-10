/**
 * Re-analyze ALL leads in Complete Financial workspace
 * Uses the improved sentiment classification with better blacklist detection.
 * Also cleans up pending drafts for leads with excluded sentiments.
 * 
 * Run with: npx tsx scripts/reanalyze-complete-financial.ts
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

// Sentiment tags
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

// Sentiments that should NOT have AI drafts
const EXCLUDED_FROM_DRAFTS = ["Neutral", "Blacklist", "Snoozed"];

/**
 * Pre-classification - only skip AI for leads with no inbound messages
 */
function preClassifySentiment(
  messages: { direction: string }[]
): SentimentTag | null {
  if (messages.length === 0) {
    return "Neutral";
  }

  const hasInboundMessages = messages.some((m) => m.direction === "inbound");
  if (!hasInboundMessages) {
    return "Neutral";
  }

  return null; // Use AI classification
}

/**
 * AI classification with improved blacklist detection
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
- "Blacklist" - Lead should be blacklisted if ANY of these apply:
  * Hostile/abusive: profanity, threats, legal action threats
  * Opt-out requests: "unsubscribe", "stop contacting", "remove me from list"
  * EMAIL BOUNCE: "delivery failed", "undeliverable", "mailbox full", "user unknown", "address not found", "does not exist", "quota exceeded"
  * FIREWALL/SPAM BLOCK: "message blocked", "rejected", "spam", "rejected by policy", "blocked by recipient"
  * System messages from mailer-daemon, postmaster, or delivery subsystem
- "Follow Up" - Lead responded but deferred action ("I'm busy right now", "contact me later", "not right now", "let me think about it", "I'll get back to you") OR gave a simple acknowledgment without commitment ("ok", "thanks", "got it")
- "Out of Office" - Lead mentions being on vacation, traveling, or temporarily unavailable
- "Interested" - Lead shows clear interest or openness ("sure", "sounds good", "I'm interested", "yes", "okay let's do it", "listening to offers", "open to suggestions")
- "Neutral" - Lead's response is genuinely ambiguous with no clear intent (this should be RARE)
</categories>

<classification_rules>
CRITICAL RULES:
1. BLACKLIST DETECTION (highest priority): Any message indicating email bounce, delivery failure, spam block, or firewall rejection → "Blacklist". Look for: "delivery failed", "undeliverable", "mailbox full", "user unknown", "blocked", "rejected", "spam", "quota exceeded", "does not exist", "address not found"
2. ANY question from the lead = engagement signal. Questions about pricing, value, cost, process, timeline, or what you're offering → "Information Requested"
3. Curious questions like "what's X go for?", "what do you have in mind?", "how much for X?" → "Information Requested"
4. "Follow Up" is ONLY for leads who responded with deferrals ("busy", "later", "not now") or simple acknowledgments ("ok", "thanks")
5. Affirmative responses like "sure", "sounds good", "yes", "I'm interested" → "Interested"
6. Only use "Neutral" when the response is truly ambiguous with zero intent signals (this is rare - most responses have some intent)
7. Only use "Not Interested" for clear rejections ("no", "not interested", "don't contact me")
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

    const result = response.output_text?.trim() as SentimentTag;

    if (result && SENTIMENT_TAGS.includes(result)) {
      return result;
    }

    if (result === "Positive") {
      return "Interested";
    }

    return "Neutral";
  } catch (error) {
    console.error("[Sentiment] Classification error:", error);
    return "Neutral";
  }
}

async function main() {
  console.log('🔄 Re-analyzing ALL leads in "Complete Financial" workspace...\n');

  // Find the Complete Financial client
  const client = await prisma.client.findFirst({
    where: { name: "Complete Financial" },
  });

  if (!client) {
    console.error('❌ Client "Complete Financial" not found!');
    process.exit(1);
  }

  console.log(`📍 Found workspace: ${client.name} (${client.id})\n`);

  // Get all leads for this client
  const leads = await prisma.lead.findMany({
    where: { clientId: client.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      sentimentTag: true,
      status: true,
      messages: {
        orderBy: { sentAt: "asc" },
        select: {
          body: true,
          direction: true,
        },
      },
    },
  });

  console.log(`📊 Found ${leads.length} total leads to process\n`);

  let processed = 0;
  let changed = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;
  let draftsDeleted = 0;

  const changes: { name: string; from: string; to: string }[] = [];
  const newBlacklisted: { name: string; reason: string }[] = [];

  // Process in batches
  const BATCH_SIZE = 5;
  const DELAY_BETWEEN_BATCHES = 1000;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (lead) => {
        const leadName =
          [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
          lead.email ||
          "Unknown";

        if (lead.messages.length === 0) {
          console.log(`⏭️  ${leadName}: No messages, skipping`);
          return { skipped: true };
        }

        try {
          // Pre-classification check
          const preClassified = preClassifySentiment(lead.messages);

          let newSentiment: SentimentTag;

          if (preClassified !== null) {
            newSentiment = preClassified;
          } else {
            // AI classification
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
              from: lead.sentimentTag || "null",
              to: newSentiment,
            });

            // Track new blacklisted leads
            if (newSentiment === "Blacklist" && lead.sentimentTag !== "Blacklist") {
              const lastInbound = lead.messages.filter(m => m.direction === "inbound").pop();
              newBlacklisted.push({
                name: leadName,
                reason: lastInbound?.body?.slice(0, 100) || "Unknown",
              });
            }

            console.log(
              `✅ ${leadName}: ${lead.sentimentTag || "null"} → ${newSentiment}`
            );

            // Delete pending drafts for excluded sentiments
            if (EXCLUDED_FROM_DRAFTS.includes(newSentiment)) {
              const deleted = await prisma.aIDraft.deleteMany({
                where: {
                  leadId: lead.id,
                  status: "pending",
                },
              });
              if (deleted.count > 0) {
                console.log(`   🗑️  Deleted ${deleted.count} pending draft(s)`);
                return { changed: true, draftsDeleted: deleted.count };
              }
            }

            return { changed: true, draftsDeleted: 0 };
          } else {
            console.log(`➖ ${leadName}: Unchanged (${newSentiment})`);
            return { unchanged: true, draftsDeleted: 0 };
          }
        } catch (error) {
          console.error(`❌ ${leadName}: Error -`, error);
          return { error: true, draftsDeleted: 0 };
        }
      })
    );

    // Count results
    for (const result of results) {
      processed++;
      if (result.status === "fulfilled") {
        if (result.value.skipped) skipped++;
        else if (result.value.changed) {
          changed++;
          draftsDeleted += result.value.draftsDeleted || 0;
        } else if (result.value.unchanged) unchanged++;
        else if (result.value.error) errors++;
      } else {
        errors++;
      }
    }

    // Progress update
    const progress = Math.round((processed / leads.length) * 100);
    console.log(`\n📈 Progress: ${processed}/${leads.length} (${progress}%)\n`);

    // Delay between batches
    if (i + BATCH_SIZE < leads.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✨ Complete Financial re-analysis complete!");
  console.log("=".repeat(60));
  console.log(`📊 Total leads: ${leads.length}`);
  console.log(`✅ Changed: ${changed}`);
  console.log(`➖ Unchanged: ${unchanged}`);
  console.log(`⏭️  Skipped (no messages): ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`🗑️  Pending drafts deleted: ${draftsDeleted}`);
  console.log("=".repeat(60));

  if (newBlacklisted.length > 0) {
    console.log("\n🚫 Newly blacklisted leads:");
    for (const bl of newBlacklisted) {
      console.log(`   - ${bl.name}: "${bl.reason}..."`);
    }
  }

  if (changes.length > 0 && changes.length <= 50) {
    console.log("\n📝 All changes:");
    for (const change of changes) {
      console.log(`   ${change.name}: ${change.from} → ${change.to}`);
    }
  } else if (changes.length > 50) {
    console.log(`\n📝 ${changes.length} total changes made (too many to list)`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
