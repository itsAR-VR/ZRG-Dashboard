/**
 * Diagnostic script to check sentiment distribution across workspaces
 * Run with: npx tsx scripts/diagnose-sentiments.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Sentiment tags that require attention
const ATTENTION_TAGS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Positive",
  "Interested",
  "Follow Up"
];

async function main() {
  console.log("🔍 Diagnosing sentiment distribution...\n");

  // Get all clients/workspaces
  const clients = await prisma.client.findMany({
    select: { id: true, name: true },
  });

  console.log(`Found ${clients.length} workspaces\n`);
  console.log("=".repeat(70));

  for (const client of clients) {
    console.log(`\n📁 Workspace: ${client.name}`);
    console.log("-".repeat(50));

    // Get all leads for this client
    const leads = await prisma.lead.findMany({
      where: { clientId: client.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        sentimentTag: true,
        status: true,
        messages: {
          select: { direction: true, channel: true },
        },
      },
    });

    // Calculate sentiment distribution
    const sentimentDistribution: Record<string, number> = {};
    let leadsWithNullSentiment = 0;
    let leadsWithInboundMessages = 0;
    let leadsWithNoInboundMessages = 0;

    for (const lead of leads) {
      if (lead.sentimentTag === null) {
        leadsWithNullSentiment++;
        sentimentDistribution["(null)"] = (sentimentDistribution["(null)"] || 0) + 1;
      } else {
        sentimentDistribution[lead.sentimentTag] = (sentimentDistribution[lead.sentimentTag] || 0) + 1;
      }

      const hasInbound = lead.messages.some(m => m.direction === "inbound");
      if (hasInbound) {
        leadsWithInboundMessages++;
      } else {
        leadsWithNoInboundMessages++;
      }
    }

    // Count attention-requiring leads
    const attentionLeads = leads.filter(
      (lead) => ATTENTION_TAGS.includes(lead.sentimentTag || "") && lead.status !== "blacklisted"
    );

    // Count pending drafts
    const pendingDrafts = await prisma.aIDraft.count({
      where: {
        status: "pending",
        lead: { clientId: client.id },
      },
    });

    console.log(`📊 Total leads: ${leads.length}`);
    console.log(`✅ Leads requiring attention: ${attentionLeads.length}`);
    console.log(`📝 Pending drafts: ${pendingDrafts}`);
    console.log(`📨 Leads with inbound messages: ${leadsWithInboundMessages}`);
    console.log(`📤 Leads with only outbound messages: ${leadsWithNoInboundMessages}`);
    console.log(`\n📈 Sentiment Distribution:`);

    // Sort by count descending
    const sortedSentiments = Object.entries(sentimentDistribution)
      .sort((a, b) => b[1] - a[1]);

    for (const [sentiment, count] of sortedSentiments) {
      const isAttention = ATTENTION_TAGS.includes(sentiment);
      const marker = isAttention ? "🔴" : "⚪";
      console.log(`   ${marker} ${sentiment}: ${count}`);
    }

    // Show sample leads with attention tags
    if (attentionLeads.length > 0 && attentionLeads.length <= 10) {
      console.log(`\n🔍 Sample attention leads:`);
      for (const lead of attentionLeads.slice(0, 5)) {
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
        console.log(`   - ${name}: ${lead.sentimentTag}`);
      }
    }
  }

  // Overall summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 OVERALL SUMMARY");
  console.log("=".repeat(70));

  const allLeads = await prisma.lead.count();
  const allAttention = await prisma.lead.count({
    where: {
      sentimentTag: { in: ATTENTION_TAGS },
      status: { not: "blacklisted" },
    },
  });
  const allDrafts = await prisma.aIDraft.count({ where: { status: "pending" } });
  const positiveLeads = await prisma.lead.count({ where: { sentimentTag: "Positive" } });
  const interestedLeads = await prisma.lead.count({ where: { sentimentTag: "Interested" } });
  const neutralLeads = await prisma.lead.count({ where: { sentimentTag: "Neutral" } });

  console.log(`Total leads across all workspaces: ${allLeads}`);
  console.log(`Total requiring attention: ${allAttention}`);
  console.log(`Total pending drafts: ${allDrafts}`);
  console.log(`\nKey sentiment counts:`);
  console.log(`   "Positive" (legacy): ${positiveLeads}`);
  console.log(`   "Interested" (current): ${interestedLeads}`);
  console.log(`   "Neutral": ${neutralLeads}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
