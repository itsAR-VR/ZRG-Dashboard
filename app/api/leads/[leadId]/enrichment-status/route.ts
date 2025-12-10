/**
 * API endpoint to get lead enrichment status
 * Used by the polling hook to monitor Clay enrichment progress
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ leadId: string }>;
}

/**
 * GET /api/leads/[leadId]/enrichment-status
 * 
 * Returns the current enrichment status, phone, and LinkedIn URL for a lead.
 * Used by the frontend polling hook to detect when enrichment completes.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { leadId } = await params;

    if (!leadId) {
      return NextResponse.json(
        { error: "Lead ID is required" },
        { status: 400 }
      );
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        enrichmentStatus: true,
        phone: true,
        linkedinUrl: true,
      },
    });

    if (!lead) {
      return NextResponse.json(
        { error: "Lead not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      enrichmentStatus: lead.enrichmentStatus,
      phone: lead.phone,
      linkedinUrl: lead.linkedinUrl,
    });
  } catch (error) {
    console.error("[Enrichment Status API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
