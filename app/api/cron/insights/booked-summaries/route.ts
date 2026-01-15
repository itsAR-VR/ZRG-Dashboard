import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMeetingBooked } from "@/lib/meeting-booking-provider";
import { coerceInsightsChatModel, coerceInsightsChatReasoningEffort } from "@/lib/insights-chat/config";
import { extractConversationInsightForLead } from "@/lib/insights-chat/thread-extractor";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  const authHeader = request.headers.get("Authorization");
  const legacySecret = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${expectedSecret}` || legacySecret === expectedSecret;
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) {
      console.warn("[Insights Cron] CRON_SECRET not configured - endpoint disabled");
      return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
    }
    if (!isAuthorized(request)) {
      console.warn("[Insights Cron] Invalid authorization attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = Math.max(1, Number.parseInt(process.env.INSIGHTS_BOOKED_SUMMARIES_CRON_LIMIT || "10", 10) || 10);

    try {
      const candidates = await prisma.lead.findMany({
      where: {
        appointmentBookedAt: { not: null },
        conversationInsight: { is: null },
      },
      select: {
        id: true,
        clientId: true,
        sentimentTag: true,
        appointmentBookedAt: true,
        ghlAppointmentId: true,
        calendlyInviteeUri: true,
        calendlyScheduledEventUri: true,
        client: {
          select: {
            settings: {
              select: {
                meetingBookingProvider: true,
                insightsChatModel: true,
                insightsChatReasoningEffort: true,
              },
            },
          },
        },
      },
      orderBy: { appointmentBookedAt: "desc" },
      take: Math.max(limit * 3, 20),
    });

    const booked = candidates.filter((lead) => {
      const provider = lead.client.settings?.meetingBookingProvider ?? "GHL";
      return isMeetingBooked(
        {
          ghlAppointmentId: lead.ghlAppointmentId,
          calendlyInviteeUri: lead.calendlyInviteeUri,
          calendlyScheduledEventUri: lead.calendlyScheduledEventUri,
        },
        { meetingBookingProvider: provider }
      );
    });

    const toProcess = booked.slice(0, limit);
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const lead of toProcess) {
      try {
        const model = coerceInsightsChatModel(lead.client.settings?.insightsChatModel ?? null);
        const effort = coerceInsightsChatReasoningEffort({
          model,
          storedValue: lead.client.settings?.insightsChatReasoningEffort ?? null,
        });

        const extracted = await extractConversationInsightForLead({
          clientId: lead.clientId,
          leadId: lead.id,
          outcome: "BOOKED",
          model,
          reasoningEffort: effort.api,
        });

        await prisma.leadConversationInsight.upsert({
          where: { leadId: lead.id },
          create: {
            leadId: lead.id,
            outcome: "BOOKED",
            insight: extracted.insight as any,
            model,
            reasoningEffort: effort.stored,
            source: "booked_cron",
            computedAt: new Date(),
            computedByUserId: null,
            computedByEmail: "cron",
          },
          update: {
            outcome: "BOOKED",
            insight: extracted.insight as any,
            model,
            reasoningEffort: effort.stored,
            source: "booked_cron",
            computedAt: new Date(),
            computedByUserId: null,
            computedByEmail: "cron",
          },
        });

        processed++;
      } catch (error) {
        // Most likely a unique constraint race or an LLM failure.
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.toLowerCase().includes("unique constraint") || msg.toLowerCase().includes("unique")) {
          skipped++;
        } else {
          failed++;
          console.error("[Insights Cron] Failed to compute booked summary:", { leadId: lead.id, error });
        }
      }
    }

      return NextResponse.json({
        success: true,
        candidates: candidates.length,
        booked: booked.length,
        processed,
        skipped,
        failed,
        limit,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Insights Cron] Error:", error);
      return NextResponse.json(
        { error: "Failed to process booked summaries", message: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  // Alias for manual triggers/external cron services.
  return GET(request);
}
