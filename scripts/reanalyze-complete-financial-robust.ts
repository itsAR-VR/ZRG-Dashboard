/**
 * Robust Re-analysis Script for Complete Financial
 * 
 * Features:
 * - Regex-based bounce detection (no AI needed for system messages)
 * - Retry logic with exponential backoff for OpenAI errors
 * - Improved prompt for short confirmations like "tomorrow works well"
 * 
 * Run with: npx tsx scripts/reanalyze-complete-financial-robust.ts
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

// Complete Financial workspace ID
const COMPLETE_FINANCIAL_ID = "731255d1-2ca5-4b37-ad34-aeb5b801be3b";

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
const EXCLUDED_FROM_DRAFTS = ["Neutral", "Blacklist", "Snoozed", "Not Interested"];

// ============================================================================
// REGEX PRE-CLASSIFICATION
// ============================================================================

/**
 * Regex patterns for detecting email bounces and system messages
 * These should be classified as "Blacklist" without calling AI
 */
const BOUNCE_PATTERNS = [
  /mail delivery (failed|failure|subsystem)/i,
  /delivery status notification/i,
  /undeliverable/i,
  /address not found/i,
  /user unknown/i,
  /mailbox (full|unavailable|not found)/i,
  /quota exceeded/i,
  /does not exist/i,
  /rejected/i,
  /access denied/i,
  /blocked/i,
  /spam/i,
  /mailer-daemon/i,
  /postmaster/i,
  /550[\s-]/i,  // SMTP error codes
  /554[\s-]/i,
  /the email account.*does not exist/i,
];

/**
 * Check if any inbound message matches bounce patterns
 */
function detectBounce(messages: { body: string; direction: string }[]): boolean {
  const inboundMessages = messages.filter(m => m.direction === "inbound");
  
  for (const msg of inboundMessages) {
    const body = msg.body.toLowerCase();
    for (const pattern of BOUNCE_PATTERNS) {
      if (pattern.test(body)) {
        return true;
      }
    }
  }
  
  return false;
}

// ============================================================================
// RETRY LOGIC
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Classify sentiment with retry logic
 * Returns null if all retries fail (instead of defaulting to Neutral)
 */
async function classifySentimentWithRetry(
  transcript: string,
  maxRetries: number = 3
): Promise<SentimentTag | null> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  const systemPrompt = `You are a sales conversation classifier. Analyze the conversation transcript and classify it into ONE category based on the LEAD's responses (not the Agent's messages).

CATEGORIES:
- "Meeting Requested" - Lead explicitly agrees to or confirms a meeting/call. Examples:
  * "tomorrow works well"
  * "yes, let's do it"
  * "I'm free on Tuesday"
  * "sounds good, when?"
  * "let's set up a call"
  * Any time/date confirmation
- "Call Requested" - Lead provides a phone number or explicitly asks to be called
- "Information Requested" - Lead asks questions or requests details about pricing, what's being offered, process, etc.
- "Not Interested" - Lead explicitly declines or says no
- "Blacklist" - Hostile/abusive messages, opt-out requests, or EMAIL BOUNCES
- "Follow Up" - Lead deferred action ("busy right now", "later", "let me think")
- "Out of Office" - Lead mentions being on vacation or temporarily unavailable
- "Interested" - Lead shows clear interest without specific action ("sounds good", "I'm interested", "tell me more")
- "Neutral" - Lead's response is genuinely ambiguous with no clear intent (RARE)

CRITICAL RULES:
1. SHORT CONFIRMATIONS like "tomorrow works well", "yes", "sounds good, when?", "let's do Tuesday" = "Meeting Requested"
2. Any time/date confirmation or agreement to meet = "Meeting Requested"
3. Phone number provided = "Call Requested"
4. Questions about the offer = "Information Requested"
5. Only use "Neutral" if truly ambiguous (very rare)

Respond with ONLY the category name, nothing else.`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Classify this conversation:\n\n${transcript}` }
        ],
        max_tokens: 50,
        temperature: 0,
      });

      const result = response.choices[0]?.message?.content?.trim() as SentimentTag;

      if (result && SENTIMENT_TAGS.includes(result)) {
        return result;
      }

      // Handle legacy "Positive" responses
      if (result === "Positive") {
        return "Interested";
      }

      return "Neutral";
    } catch (error) {
      const isRetryable = error instanceof Error && 
        (error.message.includes("500") || 
         error.message.includes("503") || 
         error.message.includes("rate") ||
         error.message.includes("timeout"));
      
      if (isRetryable && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`   ⚠️  Attempt ${attempt} failed, retrying in ${backoffMs/1000}s...`);
        await sleep(backoffMs);
      } else {
        console.error(`   ❌ Classification failed after ${attempt} attempts:`, 
          error instanceof Error ? error.message : error);
        return null; // Return null instead of defaulting to Neutral
      }
    }
  }

  return null;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

async function main() {
  console.log("🔄 Robust Re-analysis for Complete Financial\n");
  console.log("Features:");
  console.log("  ✅ Regex-based bounce detection");
  console.log("  ✅ Retry logic with exponential backoff");
  console.log("  ✅ Improved prompt for short confirmations\n");

  // Get all leads with inbound messages in Complete Financial
  const leads = await prisma.lead.findMany({
    where: {
      clientId: COMPLETE_FINANCIAL_ID,
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

  console.log(`📊 Found ${leads.length} leads with inbound messages to process\n`);

  let changed = 0;
  let unchanged = 0;
  let bounceDetected = 0;
  let aiClassified = 0;
  let failed = 0;
  let draftsDeleted = 0;

  const changes: { name: string; email: string; from: string; to: string }[] = [];
  const failures: { name: string; email: string }[] = [];

  // Process one at a time to avoid rate limits
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
    const progress = `[${i + 1}/${leads.length}]`;

    console.log(`${progress} Processing: ${leadName} (${lead.email})`);

    try {
      let newSentiment: SentimentTag | null = null;

      // Step 1: Check for bounces using regex (no AI needed)
      if (detectBounce(lead.messages)) {
        newSentiment = "Blacklist";
        bounceDetected++;
        console.log(`   📧 Bounce detected via regex → Blacklist`);
      } else {
        // Step 2: Use AI classification with retry logic
        const transcript = lead.messages
          .map(m => `${m.direction === "inbound" ? "Lead" : "Agent"}: ${m.body}`)
          .join("\n");

        newSentiment = await classifySentimentWithRetry(transcript);
        
        if (newSentiment === null) {
          // AI failed after all retries - don't update, mark as failed
          failed++;
          failures.push({ name: leadName, email: lead.email });
          console.log(`   ❌ FAILED - keeping current sentiment: ${lead.sentimentTag || "null"}`);
          continue;
        }
        
        aiClassified++;
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
          email: lead.email,
          from: lead.sentimentTag || "null",
          to: newSentiment,
        });

        console.log(`   ✅ Changed: ${lead.sentimentTag || "null"} → ${newSentiment}`);

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
            draftsDeleted += deleted.count;
          }
        }

        changed++;
      } else {
        console.log(`   ➖ Unchanged: ${newSentiment}`);
        unchanged++;
      }

      // Small delay between API calls to avoid rate limits
      if (i < leads.length - 1) {
        await sleep(300);
      }
    } catch (error) {
      console.error(`   ❌ Error:`, error);
      failed++;
      failures.push({ name: leadName, email: lead.email });
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("✨ COMPLETE FINANCIAL RE-ANALYSIS COMPLETE!");
  console.log("=".repeat(60));
  console.log(`📊 Total processed: ${leads.length}`);
  console.log(`✅ Changed: ${changed}`);
  console.log(`➖ Unchanged: ${unchanged}`);
  console.log(`📧 Bounces detected (regex): ${bounceDetected}`);
  console.log(`🤖 AI classified: ${aiClassified}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`🗑️  Drafts deleted: ${draftsDeleted}`);

  if (changes.length > 0) {
    console.log("\n📝 All changes:");
    for (const change of changes) {
      const highlight = change.to === "Meeting Requested" || change.to === "Interested" ? "🎯 " : "";
      console.log(`   ${highlight}${change.name} (${change.email}): ${change.from} → ${change.to}`);
    }
  }

  if (failures.length > 0) {
    console.log("\n⚠️  Failed leads (need manual review):");
    for (const f of failures) {
      console.log(`   - ${f.name} (${f.email})`);
    }
  }

  // Verify Sarah Barlow specifically
  console.log("\n" + "=".repeat(60));
  console.log("🔍 VERIFICATION: Sarah Barlow");
  console.log("=".repeat(60));
  
  const sarah = await prisma.lead.findFirst({
    where: { email: "sarah@gomundo.uk" },
    select: { firstName: true, lastName: true, email: true, sentimentTag: true, status: true },
  });
  
  if (sarah) {
    const expected = sarah.sentimentTag === "Meeting Requested" || sarah.sentimentTag === "Call Requested";
    console.log(`Email: ${sarah.email}`);
    console.log(`Sentiment: ${sarah.sentimentTag}`);
    console.log(`Status: ${sarah.status}`);
    console.log(`Verification: ${expected ? "✅ PASS" : "❌ FAIL (expected Meeting Requested or Call Requested)"}`);
  } else {
    console.log("❌ Sarah Barlow not found!");
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
