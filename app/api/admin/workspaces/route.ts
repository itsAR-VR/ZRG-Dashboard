import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Prisma } from "@prisma/client";

type ProvisionWorkspaceRequest = {
  // Required
  name?: string;
  ghlLocationId?: string;
  ghlPrivateKey?: string;

  // Required (one of)
  userId?: string;
  userEmail?: string;

  // Optional integrations
  emailBisonApiKey?: string;
  emailBisonWorkspaceId?: string; // numeric string
  unipileAccountId?: string;

  // Optional behavior controls
  upsert?: boolean; // if true, update an existing workspace for same ghlLocationId

  // Optional initial settings overrides
  settings?: Record<string, unknown>;
};

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function getProvidedSecret(request: NextRequest): string | null {
  // Preferred: Authorization: Bearer <secret>
  const bearer = getBearerToken(request);
  if (bearer) return bearer;

  // Some webhook tools don't support Authorization; allow a dedicated header.
  const headerSecret =
    request.headers.get("x-workspace-provisioning-secret") ??
    request.headers.get("x-admin-secret") ??
    request.headers.get("x-cron-secret");
  if (headerSecret) return headerSecret;

  // Last resort (not recommended): query string.
  const url = new URL(request.url);
  const qsSecret = url.searchParams.get("secret");
  return qsSecret || null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeEmailBisonWorkspaceId(value: unknown): string | undefined {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) return undefined;
  // People sometimes paste "# 123" from Inboxxia/EmailBison UI.
  return trimmed.replace(/^#\s*/, "");
}

function validateEmailBisonWorkspaceId(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return "emailBisonWorkspaceId must be a numeric string";
  return null;
}

function pickWorkspaceSettings(input: Record<string, unknown>): Record<string, unknown> {
  // Whitelist only fields we expect for WorkspaceSettings.
  const allowed = [
    "aiPersonaName",
    "aiTone",
    "aiGreeting",
    "aiSmsGreeting",
    "aiSignature",
    "aiGoals",
    "serviceDescription",
    "qualificationQuestions",
    "companyName",
    "targetResult",
    "autoApproveMeetings",
    "flagUncertainReplies",
    "pauseForOOO",
    "followUpsPausedUntil",
    "autoBlacklist",
    "autoFollowUpsOnReply",
    "airtableMode",
    "emailDigest",
    "slackAlerts",
    "timezone",
    "workStartTime",
    "workEndTime",
    "calendarSlotsToShow",
    "calendarLookAheadDays",
    "ghlDefaultCalendarId",
    "ghlAssignedUserId",
    "autoBookMeetings",
    "meetingDurationMinutes",
    "meetingTitle",
  ] as const;

  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  }
  return out;
}

function coerceWorkspaceSettings(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    // Keep strings as-is (trim), allow null to clear, convert numbers/booleans safely.
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.trim();
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    // Allow date strings for followUpsPausedUntil (Monday often sends ISO strings).
    if (key === "followUpsPausedUntil" && typeof value === "object") {
      // ignore unknown shapes
      continue;
    }
  }

  if (typeof values.followUpsPausedUntil === "string") {
    const str = values.followUpsPausedUntil.trim();
    out.followUpsPausedUntil = str ? new Date(str) : null;
  }

  // Numbers that Monday may send as strings.
  for (const numericField of ["calendarSlotsToShow", "calendarLookAheadDays", "meetingDurationMinutes"] as const) {
    const raw = values[numericField];
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) continue;
      out[numericField] = Math.trunc(parsed);
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[numericField] = Math.trunc(raw);
    }
  }

  for (const booleanField of [
    "autoApproveMeetings",
    "flagUncertainReplies",
    "pauseForOOO",
    "autoBlacklist",
    "autoFollowUpsOnReply",
    "airtableMode",
    "emailDigest",
    "slackAlerts",
    "autoBookMeetings",
  ] as const) {
    const raw = values[booleanField];
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (normalized === "true") out[booleanField] = true;
      if (normalized === "false") out[booleanField] = false;
    }
  }

  return out;
}

async function resolveUserId(params: {
  userId: string | null;
  userEmail: string | null;
}): Promise<{ ok: true; userId: string } | { ok: false; error: string; status: number }> {
  if (params.userId) return { ok: true, userId: params.userId };
  if (!params.userEmail) return { ok: false, error: "Provide either userId or userEmail", status: 400 };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      error: "Server misconfigured: missing Supabase env vars for userEmail lookup",
      status: 500,
    };
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  // Supabase JS doesn't expose getUserByEmail; page through users until we find a match.
  const email = params.userEmail.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[Provision Workspace] supabase listUsers error:", error);
      return { ok: false, error: "Failed to look up user by email", status: 500 };
    }

    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) return { ok: true, userId: found.id };
    if (data.users.length < perPage) break;
  }

  return { ok: false, error: "User not found for userEmail", status: 404 };
}

export async function POST(request: NextRequest) {
  const expectedSecret =
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.CRON_SECRET ??
    null;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Server misconfigured: set WORKSPACE_PROVISIONING_SECRET" },
      { status: 500 }
    );
  }

  const providedSecret = getProvidedSecret(request);
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ProvisionWorkspaceRequest | null;

  const name = normalizeOptionalString(body?.name) ?? "";
  const ghlLocationId = normalizeOptionalString(body?.ghlLocationId) ?? "";
  const ghlPrivateKey = normalizeOptionalString(body?.ghlPrivateKey) ?? "";
  const userId = normalizeOptionalString(body?.userId) ?? null;
  const userEmail = normalizeOptionalString(body?.userEmail) ?? null;

  if (!name || !ghlLocationId || !ghlPrivateKey) {
    return NextResponse.json(
      { error: "Missing required fields: name, ghlLocationId, ghlPrivateKey" },
      { status: 400 }
    );
  }

  const resolvedUser = await resolveUserId({ userId, userEmail });
  if (!resolvedUser.ok) {
    return NextResponse.json({ error: resolvedUser.error }, { status: resolvedUser.status });
  }

  const emailBisonApiKey = normalizeOptionalString(body?.emailBisonApiKey) ?? null;
  const emailBisonWorkspaceId = normalizeEmailBisonWorkspaceId(body?.emailBisonWorkspaceId) ?? null;
  const unipileAccountId = normalizeOptionalString(body?.unipileAccountId) ?? null;
  const upsert = body?.upsert === true;

  const workspaceIdError = validateEmailBisonWorkspaceId(emailBisonWorkspaceId ?? undefined);
  if (workspaceIdError) {
    return NextResponse.json({ error: workspaceIdError }, { status: 400 });
  }

  const rawSettings = body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
    ? (body.settings as Record<string, unknown>)
    : null;
  const settings = rawSettings ? coerceWorkspaceSettings(pickWorkspaceSettings(rawSettings)) : null;

  if (settings?.followUpsPausedUntil instanceof Date) {
    if (Number.isNaN(settings.followUpsPausedUntil.getTime())) {
      return NextResponse.json(
        { error: "settings.followUpsPausedUntil must be an ISO date string" },
        { status: 400 }
      );
    }
  }

  for (const numericField of ["calendarSlotsToShow", "calendarLookAheadDays", "meetingDurationMinutes"] as const) {
    const raw = settings?.[numericField];
    if (typeof raw === "number" && raw < 0) {
      return NextResponse.json(
        { error: `settings.${numericField} must be >= 0` },
        { status: 400 }
      );
    }
  }

  try {
    // Idempotency / conflict handling.
    const existing = await prisma.client.findUnique({ where: { ghlLocationId } });

    if (existing) {
      // Don't allow silently reassigning workspaces across owners.
      if (existing.userId !== resolvedUser.userId) {
        return NextResponse.json(
          { error: "Workspace already exists for this locationId under a different user" },
          { status: 409 }
        );
      }

      if (emailBisonWorkspaceId) {
        const conflict = await prisma.client.findFirst({
          where: {
            emailBisonWorkspaceId,
            id: { not: existing.id },
          },
          select: { id: true },
        });
        if (conflict) {
          return NextResponse.json(
            { error: "emailBisonWorkspaceId is already in use by another workspace" },
            { status: 409 }
          );
        }
      }

      if (upsert) {
        const updated = await prisma.$transaction(async (tx) => {
          const workspace = await tx.client.update({
            where: { id: existing.id },
            data: {
              name,
              ghlPrivateKey,
              emailBisonApiKey,
              emailBisonWorkspaceId,
              unipileAccountId,
            },
            select: {
              id: true,
              name: true,
              userId: true,
              ghlLocationId: true,
              emailBisonWorkspaceId: true,
              unipileAccountId: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          await tx.workspaceSettings.upsert({
            where: { clientId: existing.id },
            create: { clientId: existing.id, ...(settings ?? {}) },
            update: { ...(settings ?? {}) },
          });

          const reactivationCount = await tx.reactivationCampaign.count({ where: { clientId: existing.id } });
          if (reactivationCount === 0) {
            await tx.reactivationCampaign.create({
              data: {
                clientId: existing.id,
                name: "Reactivation",
                isActive: true,
                dailyLimitPerSender: 5,
                bumpMessageTemplate:
                  "Hey {firstName} — just bumping this. Is it worth discussing this now, or should I circle back later?",
              },
            });
          }

          return workspace;
        });

        return NextResponse.json({ success: true, existed: true, updated: true, workspace: updated }, { status: 200 });
      }

      return NextResponse.json(
        {
          success: true,
          existed: true,
          updated: false,
          workspace: {
            id: existing.id,
            name: existing.name,
            userId: existing.userId,
            ghlLocationId: existing.ghlLocationId,
            emailBisonWorkspaceId: existing.emailBisonWorkspaceId,
            unipileAccountId: existing.unipileAccountId,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
          },
        },
        { status: 200 }
      );
    }

    if (emailBisonWorkspaceId) {
      const existingByWorkspaceId = await prisma.client.findUnique({
        where: { emailBisonWorkspaceId },
        select: { id: true },
      });
      if (existingByWorkspaceId) {
        return NextResponse.json(
          { error: "emailBisonWorkspaceId is already in use by another workspace" },
          { status: 409 }
        );
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const workspace = await tx.client.create({
        data: {
          name,
          ghlLocationId,
          ghlPrivateKey,
          emailBisonApiKey,
          emailBisonWorkspaceId,
          unipileAccountId,
          userId: resolvedUser.userId,
        },
        select: {
          id: true,
          name: true,
          userId: true,
          ghlLocationId: true,
          emailBisonWorkspaceId: true,
          unipileAccountId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.workspaceSettings.create({
        data: {
          clientId: workspace.id,
          ...(settings ?? {}),
        },
      });

      await tx.reactivationCampaign.create({
        data: {
          clientId: workspace.id,
          name: "Reactivation",
          isActive: true,
          dailyLimitPerSender: 5,
          bumpMessageTemplate:
            "Hey {firstName} — just bumping this. Is it worth discussing this now, or should I circle back later?",
        },
      });

      return workspace;
    });

    return NextResponse.json({ success: true, existed: false, workspace: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Unique constraint violation (race condition)
      return NextResponse.json({ error: "Workspace already exists (unique constraint)" }, { status: 409 });
    }

    console.error("[Provision Workspace] error:", error);
    return NextResponse.json(
      { error: "Failed to provision workspace" },
      { status: 500 }
    );
  }
}
