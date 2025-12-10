/**
 * Diagnostic script for a specific lead (Sarah Barlow)
 * Run with: npx tsx scripts/diagnose-single-lead.ts
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
  const searchTerm = "Sarah";
  console.log(`🔍 Searching for lead "${searchTerm}" in Complete Financial...`);

  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { firstName: { contains: searchTerm, mode: "insensitive" } },
        { lastName: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
      ],
      client: {
        name: "Complete Financial"
      }
    },
    include: {
      messages: {
        orderBy: { sentAt: "asc" }
      }
    }
  });

  console.log(`Found ${leads.length} leads matching "${searchTerm}"`);

  for (const lead of leads) {
    console.log("\n" + "=".repeat(50));
    console.log(`👤 Name: ${lead.firstName} ${lead.lastName}`);
    console.log(`📧 Email: ${lead.email}`);
    console.log(`🏷️  Sentiment: ${lead.sentimentTag}`);
    console.log(`📊 Status: ${lead.status}`);
    console.log(`💬 Messages: ${lead.messages.length}`);

    if (lead.messages.length > 0) {
      console.log("\nRecent Messages:");
      // Show last 5 messages
      lead.messages.slice(-5).forEach(m => {
        console.log(`   [${m.direction.toUpperCase()} - ${m.channel}] ${m.sentAt.toISOString()}: ${m.body.substring(0, 100).replace(/\n/g, " ")}...`);
      });
    } else {
      console.log("\n❌ NO MESSAGES FOUND IN DATABASE");
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
