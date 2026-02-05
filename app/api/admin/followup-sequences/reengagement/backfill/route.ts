import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backfillReengagementFollowUpSequence } from "@/lib/maintenance/backfill-reengagement-followup";
import { verifyAdminActionSecret } from "@/lib/admin-actions-auth";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function ensureAuthorized(request: NextRequest): NextResponse | null {
  const result = verifyAdminActionSecret({ headers: request.headers });
  if (result.ok) return null;
  return NextResponse.json({ error: result.reason }, { status: result.status });
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseInt((raw || "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

type BackfillRequestBody = {
  apply?: boolean;
  clientId?: string;
  allClients?: boolean;
  confirmAllClients?: string;
  overwriteExisting?: boolean;
  isActive?: boolean;
  limit?: number;
};

const CONFIRM_ALL_CLIENTS = "YES";

export async function GET(request: NextRequest) {
  const auth = ensureAuthorized(request);
  if (auth) return auth;

  const url = new URL(request.url);
  const clientId = normalizeOptionalString(url.searchParams.get("clientId"));
  const limit = parsePositiveInt(url.searchParams.get("limit"), 0) || undefined;
  const overwriteExisting = url.searchParams.get("overwriteExisting") === "true";
  const isActiveParam = url.searchParams.get("isActive");
  const isActive = isActiveParam === "true" ? true : isActiveParam === "false" ? false : undefined;

  const result = await backfillReengagementFollowUpSequence(prisma, {
    apply: false,
    clientId,
    ...(clientId ? {} : { allClients: true }),
    ...(limit ? { limit } : {}),
    overwriteExisting,
    ...(isActive !== undefined ? { isActive } : {}),
  });

  return NextResponse.json({
    ok: true,
    mode: "dry-run",
    options: { clientId: clientId ?? null, limit: limit ?? null, overwriteExisting, isActive: isActive ?? null },
    result,
  });
}

export async function POST(request: NextRequest) {
  const auth = ensureAuthorized(request);
  if (auth) return auth;

  let body: BackfillRequestBody = {};
  try {
    body = (await request.json()) as BackfillRequestBody;
  } catch {
    body = {};
  }

  const apply = body.apply === true;
  if (!apply) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing apply=true. Use GET for dry-run, or POST with { apply: true, ... } to apply changes.",
      },
      { status: 400 }
    );
  }

  const clientId = normalizeOptionalString(body.clientId);
  const allClients = body.allClients === true;

  if (!clientId && !allClients) {
    return NextResponse.json(
      { ok: false, error: 'Specify "clientId" or set allClients=true.' },
      { status: 400 }
    );
  }

  if (!clientId && allClients) {
    const confirm = normalizeOptionalString(body.confirmAllClients) ?? "";
    if (confirm !== CONFIRM_ALL_CLIENTS) {
      return NextResponse.json(
        { ok: false, error: `Missing confirmAllClients=\"${CONFIRM_ALL_CLIENTS}\".` },
        { status: 400 }
      );
    }
  }

  const overwriteExisting = body.overwriteExisting === true;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : undefined;
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : undefined;

  const result = await backfillReengagementFollowUpSequence(prisma, {
    apply: true,
    ...(clientId ? { clientId } : {}),
    ...(allClients ? { allClients: true } : {}),
    ...(limit ? { limit } : {}),
    overwriteExisting,
    ...(isActive !== undefined ? { isActive } : {}),
  });

  return NextResponse.json({
    ok: result.ok,
    mode: "apply",
    options: {
      clientId: clientId ?? null,
      allClients: Boolean(allClients),
      overwriteExisting,
      isActive: isActive ?? null,
      limit: limit ?? null,
    },
    result,
  });
}
