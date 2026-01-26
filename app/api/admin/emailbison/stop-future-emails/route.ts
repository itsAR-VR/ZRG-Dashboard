import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stopEmailBisonCampaignFutureEmailsForLeads } from "@/lib/emailbison-api";

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

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret =
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.CRON_SECRET ??
    null;

  if (!expectedSecret) return false;
  return getProvidedSecret(request) === expectedSecret;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

type StopFutureEmailsBody = {
  apply?: boolean;
  clientId?: string;
  allClients?: boolean;
  confirmAllClients?: string;
  sinceDays?: number;
  batchSize?: number;
  maxLeadsPerClient?: number;
};

type LeadCandidate = {
  id: string;
  emailBisonLeadId: string;
  emailCampaign: { bisonCampaignId: string } | null;
};

async function collectCandidates(clientId: string, sinceDays: number, maxLeads: number): Promise<LeadCandidate[]> {
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: {
      clientId,
      emailBisonLeadId: { not: null },
      OR: [{ lastInboundAt: { gte: cutoff } }, { lastZrgOutboundAt: { gte: cutoff } }],
      emailCampaign: { isNot: null },
    },
    orderBy: { lastInboundAt: "desc" },
    take: maxLeads,
    select: {
      id: true,
      emailBisonLeadId: true,
      emailCampaign: { select: { bisonCampaignId: true } },
    },
  });

  return leads
    .map((l) => ({
      id: l.id,
      emailBisonLeadId: l.emailBisonLeadId!,
      emailCampaign: l.emailCampaign,
    }))
    .filter((l) => Boolean(l.emailCampaign?.bisonCampaignId));
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const clientId = normalizeOptionalString(url.searchParams.get("clientId"));
  const sinceDays = parsePositiveInt(url.searchParams.get("sinceDays"), 30);
  const maxLeadsPerClient = parsePositiveInt(url.searchParams.get("maxLeadsPerClient"), 500);

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId is required for GET (dry-run)" }, { status: 400 });
  }

  const candidates = await collectCandidates(clientId, sinceDays, maxLeadsPerClient);
  const byCampaign = new Map<string, number>();
  for (const c of candidates) {
    const campaignId = c.emailCampaign?.bisonCampaignId;
    if (!campaignId) continue;
    byCampaign.set(campaignId, (byCampaign.get(campaignId) ?? 0) + 1);
  }

  return NextResponse.json({
    ok: true,
    mode: "dry-run",
    options: { clientId, sinceDays, maxLeadsPerClient },
    result: {
      candidates: candidates.length,
      campaigns: byCampaign.size,
      byCampaign: Array.from(byCampaign.entries()).map(([bisonCampaignId, leadCount]) => ({ bisonCampaignId, leadCount })),
    },
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: StopFutureEmailsBody = {};
  try {
    body = (await request.json()) as StopFutureEmailsBody;
  } catch {
    body = {};
  }

  const apply = body.apply === true;
  const allClients = body.allClients === true;
  const clientId = normalizeOptionalString(body.clientId);

  if (!apply) {
    return NextResponse.json(
      { ok: false, error: "Missing apply=true. Use GET for dry-run, or POST with { apply: true, ... } to apply." },
      { status: 400 }
    );
  }

  if (allClients) {
    if (body.confirmAllClients !== "ALL_CLIENTS") {
      return NextResponse.json({ ok: false, error: 'allClients requires confirmAllClients="ALL_CLIENTS"' }, { status: 400 });
    }
  } else if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId is required unless allClients=true" }, { status: 400 });
  }

  const sinceDays = parsePositiveInt(body.sinceDays, 30);
  const batchSize = Math.min(500, parsePositiveInt(body.batchSize, 100));
  const maxLeadsPerClient = Math.min(5000, parsePositiveInt(body.maxLeadsPerClient, 500));

  const clients = allClients
    ? await prisma.client.findMany({
        where: { emailBisonApiKey: { not: null } },
        select: { id: true, emailBisonApiKey: true, emailBisonBaseHost: { select: { host: true } } },
      })
    : await prisma.client.findMany({
        where: { id: clientId!, emailBisonApiKey: { not: null } },
        select: { id: true, emailBisonApiKey: true, emailBisonBaseHost: { select: { host: true } } },
      });

  const summary = {
    clients: 0,
    candidates: 0,
    campaigns: 0,
    apiCalls: 0,
    succeeded: 0,
    failed: 0,
    errors: [] as Array<{ clientId: string; bisonCampaignId: string; error: string }>,
  };

  for (const client of clients) {
    summary.clients += 1;
    const apiKey = (client.emailBisonApiKey || "").trim();
    if (!apiKey) continue;

    const candidates = await collectCandidates(client.id, sinceDays, maxLeadsPerClient);
    summary.candidates += candidates.length;

    const groups = new Map<string, string[]>();
    for (const c of candidates) {
      const bisonCampaignId = c.emailCampaign?.bisonCampaignId;
      if (!bisonCampaignId) continue;
      const list = groups.get(bisonCampaignId) ?? [];
      list.push(c.emailBisonLeadId);
      groups.set(bisonCampaignId, list);
    }
    summary.campaigns += groups.size;

    for (const [bisonCampaignId, leadIds] of groups.entries()) {
      for (let i = 0; i < leadIds.length; i += batchSize) {
        const chunk = leadIds.slice(i, i + batchSize);
        summary.apiCalls += 1;

        const res = await stopEmailBisonCampaignFutureEmailsForLeads(apiKey, bisonCampaignId, chunk, {
          baseHost: client.emailBisonBaseHost?.host ?? null,
        });

        if (res.success) {
          summary.succeeded += 1;
        } else {
          summary.failed += 1;
          summary.errors.push({ clientId: client.id, bisonCampaignId, error: res.error || "unknown_error" });
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    mode: "apply",
    options: {
      scope: allClients ? "all-clients" : { clientId },
      sinceDays,
      batchSize,
      maxLeadsPerClient,
    },
    result: summary,
  });
}
