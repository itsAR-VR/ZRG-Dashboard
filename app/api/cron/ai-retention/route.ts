import { NextRequest, NextResponse } from "next/server";
import { pruneOldAIInteractions } from "@/lib/ai/retention";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await pruneOldAIInteractions({ retentionDays: 30 });
    return NextResponse.json({ success: true, retentionDays: 30 });
  } catch (error) {
    console.error("[AI Retention] Cron failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}

