import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dedupeEmailBisonOutboundMessages } from "@/lib/maintenance/dedupe-emailbison-outbound";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

function getProvidedSecret(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) return token;

  const headerSecret =
    request.headers.get("x-admin-secret") ??
    request.headers.get("x-cron-secret") ??
    request.headers.get("x-workspace-provisioning-secret");
  if (headerSecret) return headerSecret;

  const url = new URL(request.url);
  return url.searchParams.get("secret") || null;
}

function parsePositiveInt(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseInt((raw || "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret =
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.CRON_SECRET ??
    null;

  if (!expectedSecret) return false;
  return getProvidedSecret(request) === expectedSecret;
}

type DedupeRequestBody = {
  apply?: boolean;
  clientId?: string;
  allClients?: boolean;
  confirmAllClients?: string;
  sinceDays?: number;
  windowSeconds?: number;
  batchSize?: number;
  maxBatches?: number;
  recomputeRollups?: boolean;
  verbose?: boolean;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseBodyPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const clientId = normalizeOptionalString(url.searchParams.get("clientId"));

  const sinceDays = parsePositiveInt(url.searchParams.get("sinceDays"), 365);
  const windowSeconds = parsePositiveInt(url.searchParams.get("windowSeconds"), 120);
  const batchSize = parsePositiveInt(url.searchParams.get("batchSize"), 200);

  const result = await dedupeEmailBisonOutboundMessages(prisma, {
    clientId,
    sinceDays,
    windowSeconds,
    batchSize,
    maxBatches: 1,
    apply: false,
    verbose: url.searchParams.get("verbose") === "true",
    recomputeRollups: false,
  });

  return NextResponse.json({
    ok: true,
    mode: "dry-run",
    options: { clientId: clientId ?? null, sinceDays, windowSeconds, batchSize },
    result,
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DedupeRequestBody = {};
  try {
    body = (await request.json()) as DedupeRequestBody;
  } catch {
    body = {};
  }

  const apply = body.apply === true;
  const allClients = body.allClients === true;
  const clientId = normalizeOptionalString(body.clientId);

  if (!apply) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing apply=true. Use GET for dry-run, or POST with { apply: true, ... } to apply changes.",
      },
      { status: 400 }
    );
  }

  if (allClients) {
    if (body.confirmAllClients !== "ALL_CLIENTS") {
      return NextResponse.json(
        {
          ok: false,
          error: 'allClients requires confirmAllClients="ALL_CLIENTS"',
        },
        { status: 400 }
      );
    }
  } else if (!clientId) {
    return NextResponse.json(
      {
        ok: false,
        error: "clientId is required unless allClients=true",
      },
      { status: 400 }
    );
  }

  const sinceDays = parseBodyPositiveInt(body.sinceDays, 365);
  const windowSeconds = parseBodyPositiveInt(body.windowSeconds, 120);
  const batchSize = parseBodyPositiveInt(body.batchSize, 500);
  const maxBatches = parseBodyPositiveInt(body.maxBatches, 200);
  const recomputeRollups = body.recomputeRollups !== false;
  const verbose = body.verbose === true;

  const result = await dedupeEmailBisonOutboundMessages(prisma, {
    clientId: allClients ? undefined : clientId,
    sinceDays,
    windowSeconds,
    batchSize,
    maxBatches,
    apply: true,
    verbose,
    recomputeRollups,
  });

  return NextResponse.json({
    ok: true,
    mode: "apply",
    options: {
      scope: allClients ? "all-clients" : { clientId },
      sinceDays,
      windowSeconds,
      batchSize,
      maxBatches,
      recomputeRollups,
    },
    result,
  });
}

