/**
 * Migrate all leads with "Positive" sentiment tag to "Interested"
 * This is a one-time migration as we're consolidating these tags.
 * 
 * Run with: npx tsx scripts/migrate-positive-to-interested.ts
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
  console.log("🔄 Migrating 'Positive' leads to 'Interested'...\n");

  try {
    // Count leads with "Positive" sentiment
    const positiveCount = await prisma.lead.count({
      where: { sentimentTag: "Positive" }
    });

    console.log(`📊 Found ${positiveCount} leads with "Positive" sentiment tag`);

    if (positiveCount > 0) {
      // Update all "Positive" to "Interested"
      const result = await prisma.lead.updateMany({
        where: { sentimentTag: "Positive" },
        data: { sentimentTag: "Interested" }
      });

      console.log(`✅ Migrated ${result.count} leads from "Positive" to "Interested"`);
    } else {
      console.log("✅ No leads to migrate");
    }
  } catch (error) {
    console.error("❌ Error during migration:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
