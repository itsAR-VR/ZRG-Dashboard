/**
 * Re-analyze leads across ALL workspaces
 * Uses improved sentiment classification that considers ALL message channels.
 * 
 * Run with: npx tsx scripts/reanalyze-all-workspaces.ts
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
  "Automated Reply",
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
  "Automated Reply": "new",
  "Interested": "qualified",
  "Neutral": "new",
  "Snoozed": "new",
};

// Sentiments that should NOT have AI drafts
const EXCLUDED_FROM_DRAFTS = ["Neutral", "Blacklist", "Snoozed", "Automated Reply"];

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

    const raw = response.output_text?.trim() || "";
    const cleaned = raw.replace(/^[\"'`]+|[\"'`]+$/g, "").replace(/\.$/, "").trim();

    // Handle legacy "Positive" responses
    if (cleaned === "Positive") {
      return "Interested";
    }

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

async function processWorkspace(clientId: string, clientName: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📁 Processing: ${clientName}`);
  console.log("=".repeat(60));

  // Get all leads for this client that have inbound messages
  // (leads without inbound messages are already correctly Neutral)
  const leads = await prisma.lead.findMany({
    where: {
      clientId,
      messages: {
        some: { direction: "inbound" },
      },
    },
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
          channel: true,
        },
      },
    },
  });

  console.log(`📊 Found ${leads.length} leads with inbound messages to process`);

  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  let draftsDeleted = 0;

  const changes: { name: string; from: string; to: string }[] = [];

  // Process in batches
  const BATCH_SIZE = 5;
  const DELAY_BETWEEN_BATCHES = 500;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (lead) => {
        const leadName =
          [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
          lead.email ||
          "Unknown";

        try {
          // Build transcript from ALL messages (all channels)
          const transcript = lead.messages
            .map(
              (m) =>
                `${m.direction === "inbound" ? "Lead" : "Agent"}: ${m.body}`
            )
            .join("\n");

          // Use AI classification (we know these leads have inbound messages)
          const newSentiment = await classifySentiment(transcript);
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
      if (result.status === "fulfilled") {
        if (result.value.changed) {
          changed++;
          draftsDeleted += result.value.draftsDeleted || 0;
        } else if (result.value.unchanged) {
          unchanged++;
        } else if (result.value.error) {
          errors++;
        }
      } else {
        errors++;
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < leads.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }

  console.log(`\n📈 ${clientName} Summary:`);
  console.log(`   ✅ Changed: ${changed}`);
  console.log(`   ➖ Unchanged: ${unchanged}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   🗑️  Drafts deleted: ${draftsDeleted}`);

  return { changed, unchanged, errors, draftsDeleted, changes };
}

async function main() {
  console.log("🔄 Re-analyzing leads across ALL workspaces...\n");
  console.log("This only processes leads with inbound messages.\n");

  // Get all clients/workspaces
  const clients = await prisma.client.findMany({
    select: { id: true, name: true },
  });

  console.log(`Found ${clients.length} workspaces to process`);

  let totalChanged = 0;
  let totalUnchanged = 0;
  let totalErrors = 0;
  let totalDraftsDeleted = 0;
  const allChanges: { workspace: string; name: string; from: string; to: string }[] = [];

  for (const client of clients) {
    const result = await processWorkspace(client.id, client.name);
    totalChanged += result.changed;
    totalUnchanged += result.unchanged;
    totalErrors += result.errors;
    totalDraftsDeleted += result.draftsDeleted;

    for (const change of result.changes) {
      allChanges.push({ workspace: client.name, ...change });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✨ ALL WORKSPACES COMPLETE!");
  console.log("=".repeat(60));
  console.log(`📊 Total changed: ${totalChanged}`);
  console.log(`➖ Total unchanged: ${totalUnchanged}`);
  console.log(`❌ Total errors: ${totalErrors}`);
  console.log(`🗑️  Total drafts deleted: ${totalDraftsDeleted}`);

  if (allChanges.length > 0 && allChanges.length <= 50) {
    console.log("\n📝 All changes:");
    for (const change of allChanges) {
      console.log(`   [${change.workspace}] ${change.name}: ${change.from} → ${change.to}`);
    }
  } else if (allChanges.length > 50) {
    console.log(`\n📝 ${allChanges.length} total changes made (too many to list)`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
