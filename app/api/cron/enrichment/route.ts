/**
 * Cron job for batch processing leads that need enrichment
 * Processes leads with enrichmentStatus = 'pending' and POSITIVE sentiment
 * Implements exponential backoff retry logic (max 3 retries)
 * Rate-limited to avoid overwhelming Clay API
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerEnrichmentForLead } from "@/lib/clay-api";
import { POSITIVE_SENTIMENTS } from "@/lib/sentiment";

// Batch size for processing
const BATCH_SIZE = 10;

// Max retry attempts before marking as failed
const MAX_RETRIES = 3;

// Retry delay intervals in milliseconds
// Retry 1: 1 minute, Retry 2: 5 minutes, Retry 3: 15 minutes
const RETRY_DELAYS_MS = [
  1 * 60 * 1000,   // 1 minute
  5 * 60 * 1000,   // 5 minutes
  15 * 60 * 1000,  // 15 minutes
];

/**
 * Check if enough time has passed for a retry attempt
 */
function canRetry(retryCount: number, lastRetryAt: Date | null): boolean {
  if (retryCount >= MAX_RETRIES) return false;
  if (!lastRetryAt) return true;
  
  const delayMs = RETRY_DELAYS_MS[retryCount - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  const timeSinceLastRetry = Date.now() - lastRetryAt.getTime();
  
  return timeSinceLastRetry >= delayMs;
}

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
    // Find leads that need enrichment:
    // 1. Status is 'pending'
    // 2. Has email (required for Clay)
    // 3. Has POSITIVE sentiment (Meeting Requested, Call Requested, Info Requested, Interested)
    // 4. Missing LinkedIn or phone
    // 5. Either: hasn't been retried yet, OR enough time has passed since last retry
    const leadsToEnrich = await prisma.lead.findMany({
      where: {
        enrichmentStatus: "pending",
        email: { not: null },
        sentimentTag: { in: [...POSITIVE_SENTIMENTS] },
        // Don't re-enrich leads that already have data
        OR: [
          { linkedinUrl: null },
          { phone: null },
        ],
        // Only process leads that haven't exceeded retry limit
        enrichmentRetryCount: { lt: MAX_RETRIES },
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

    console.log(`[Enrichment Cron] Found ${leadsToEnrich.length} candidates, checking retry eligibility...`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const lead of leadsToEnrich) {
      // Check if enough time has passed for retry
      if (lead.enrichmentRetryCount > 0 && !canRetry(lead.enrichmentRetryCount, lead.enrichmentLastRetry)) {
        skippedCount++;
        continue;
      }

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
        // Update retry tracking BEFORE attempting
        const newRetryCount = lead.enrichmentRetryCount + 1;
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            enrichmentRetryCount: newRetryCount,
            enrichmentLastRetry: new Date(),
          },
        });

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
          console.log(`[Enrichment Cron] Triggered enrichment for lead ${lead.id} (attempt ${newRetryCount}/${MAX_RETRIES}, linkedin: ${result.linkedInSent}, phone: ${result.phoneSent})`);
        } else {
          // Rate limit hit or failed - check if we should mark as failed
          if (newRetryCount >= MAX_RETRIES) {
            await prisma.lead.update({
              where: { id: lead.id },
              data: { enrichmentStatus: "failed" },
            });
            console.log(`[Enrichment Cron] Lead ${lead.id} marked as failed after ${MAX_RETRIES} attempts`);
          } else {
            console.log(`[Enrichment Cron] Rate limit reached for lead ${lead.id}, will retry later (attempt ${newRetryCount}/${MAX_RETRIES})`);
          }
          // Stop processing this batch if rate limited
          break;
        }
      } catch (error) {
        errorCount++;
        
        // Retry tracking was already persisted at the start of the try block
        // Fetch the current retry count from DB to get the updated value
        const updatedLead = await prisma.lead.findUnique({
          where: { id: lead.id },
          select: { enrichmentRetryCount: true },
        });
        const currentRetryCount = updatedLead?.enrichmentRetryCount ?? lead.enrichmentRetryCount + 1;
        
        // Mark as failed if max retries exceeded
        if (currentRetryCount >= MAX_RETRIES) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { enrichmentStatus: "failed" },
          });
          console.error(`[Enrichment Cron] Lead ${lead.id} failed permanently after ${MAX_RETRIES} attempts:`, error);
        } else {
          console.error(`[Enrichment Cron] Error processing lead ${lead.id} (attempt ${currentRetryCount}/${MAX_RETRIES}):`, error);
        }
      }
    }

    console.log(`[Enrichment Cron] Batch complete - Success: ${successCount}, Errors: ${errorCount}, Skipped (waiting for retry): ${skippedCount}`);

    return NextResponse.json({
      success: true,
      processed: successCount,
      errors: errorCount,
      skipped: skippedCount,
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
