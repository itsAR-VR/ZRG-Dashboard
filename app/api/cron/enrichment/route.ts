/**
 * Cron job for batch processing leads that need enrichment
 * Processes leads with enrichmentStatus = 'pending'
 * Rate-limited to avoid overwhelming Clay API
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerEnrichmentForLead } from "@/lib/clay-api";

// Batch size for processing
const BATCH_SIZE = 10;

// Secret for cron authentication (use CRON_SECRET env var)
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.warn("[Enrichment Cron] CRON_SECRET not configured");
    return true; // Allow in development
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  // Verify cron authentication
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Enrichment Cron] Starting batch enrichment job");

  try {
    // Find leads that need enrichment
    // Only email leads (has email), not SMS-only (would have phone but no email)
    const leadsToEnrich = await prisma.lead.findMany({
      where: {
        enrichmentStatus: "pending",
        email: { not: null },
        // Don't re-enrich leads that already have data
        OR: [
          { linkedinUrl: null },
          { phone: null },
        ],
      },
      take: BATCH_SIZE,
      orderBy: { createdAt: "asc" }, // Process oldest first
    });

    if (leadsToEnrich.length === 0) {
      console.log("[Enrichment Cron] No leads to process");
      return NextResponse.json({
        success: true,
        processed: 0,
        message: "No pending enrichments",
      });
    }

    console.log(`[Enrichment Cron] Processing ${leadsToEnrich.length} leads`);

    let successCount = 0;
    let errorCount = 0;

    for (const lead of leadsToEnrich) {
      const missingLinkedIn = !lead.linkedinUrl;
      const missingPhone = !lead.phone;

      if (!missingLinkedIn && !missingPhone) {
        // Lead no longer needs enrichment, update status
        await prisma.lead.update({
          where: { id: lead.id },
          data: { enrichmentStatus: "not_needed" },
        });
        continue;
      }

      try {
        // Build ClayEnrichmentRequest object
        const enrichmentRequest = {
          leadId: lead.id,
          emailAddress: lead.email!,
          firstName: lead.firstName || undefined,
          lastName: lead.lastName || undefined,
          fullName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || undefined,
          companyName: lead.companyName || undefined,
          companyDomain: lead.companyWebsite || undefined,
          state: lead.companyState || undefined,
          linkedInProfile: lead.linkedinUrl || undefined,
        };

        const result = await triggerEnrichmentForLead(
          enrichmentRequest,
          missingLinkedIn,
          missingPhone
        );

        if (result.linkedInSent || result.phoneSent) {
          successCount++;
          console.log(`[Enrichment Cron] Triggered enrichment for lead ${lead.id} (linkedin: ${result.linkedInSent}, phone: ${result.phoneSent})`);
        } else {
          // Rate limit hit, stop processing
          console.log(`[Enrichment Cron] Rate limit reached, stopping batch`);
          break;
        }
      } catch (error) {
        errorCount++;
        console.error(`[Enrichment Cron] Error processing lead ${lead.id}:`, error);
      }
    }

    console.log(`[Enrichment Cron] Batch complete - Success: ${successCount}, Errors: ${errorCount}`);

    return NextResponse.json({
      success: true,
      processed: successCount,
      errors: errorCount,
      message: `Processed ${successCount} leads`,
    });
  } catch (error) {
    console.error("[Enrichment Cron] Job failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Manual trigger endpoint (POST)
export async function POST(request: NextRequest) {
  // Verify authentication (either cron secret or admin auth)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Could add additional admin auth check here
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Process same as GET but can be triggered manually
  return GET(request);
}
