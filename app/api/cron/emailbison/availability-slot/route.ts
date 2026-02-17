import { NextRequest, NextResponse } from "next/server";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { processEmailBisonFirstTouchAvailabilitySlots } from "@/lib/emailbison-first-touch-availability";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  const legacy = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
}

export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
      const timeBudgetMsParam = request.nextUrl.searchParams.get("timeBudgetMs");
      const timeBudgetMs = timeBudgetMsParam ? Number.parseInt(timeBudgetMsParam, 10) : undefined;

      const result = await processEmailBisonFirstTouchAvailabilitySlots({
        dryRun,
        timeBudgetMs,
      });

      return NextResponse.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Cron] EmailBison availability-slot error:", error);
      return NextResponse.json(
        {
          success: false,
          errors: [error instanceof Error ? error.message : String(error)],
          error: "Failed to process EmailBison availability slots",
          message: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
