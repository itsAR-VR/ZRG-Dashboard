/**
 * Inspect a specific lead by email to debug sentiment/message issues
 * Run with: npx tsx scripts/inspect-lead.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "sarah@gomundo.co.uk"; // Trying the email mentioned (corrected domain guess or partial search)
  // The user wrote "sarah@go Mundo UK". I'll search by first/last name too just in case.

  console.log(`🔍 Searching for Sarah Barlow...`);

  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { email: { contains: "sarah", mode: "insensitive" } },
        { firstName: { contains: "Sarah", mode: "insensitive" } },
        { lastName: { contains: "Barlow", mode: "insensitive" } },
      ]
    },
    include: {
      messages: {
        orderBy: { sentAt: 'asc' }
      },
      client: true
    }
  });

  console.log(`Found ${leads.length} matches.`);

  for (const lead of leads) {
    console.log("\n" + "=".repeat(50));
    console.log(`👤 Lead: ${lead.firstName} ${lead.lastName}`);
    console.log(`📧 Email: ${lead.email}`);
    console.log(`🏢 Workspace: ${lead.client.name} (${lead.clientId})`);
    console.log(`🏷️  Sentiment: ${lead.sentimentTag}`);
    console.log(`📊 Status: ${lead.status}`);
    console.log(`💬 Messages: ${lead.messages.length}`);

    if (lead.messages.length > 0) {
      console.log("\n📜 Message History:");
      lead.messages.forEach(m => {
        console.log(`   [${m.direction.toUpperCase()}] ${m.channel} (${m.sentAt.toISOString()}): ${m.body.substring(0, 100)}...`);
      });
    } else {
      console.log("\n❌ NO MESSAGES FOUND");
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
