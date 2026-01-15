import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient, resolveSupabaseUserIdByEmail } from "@/lib/supabase/admin";
import { Prisma } from "@prisma/client";

type BootstrapWorkspaceRequest = {
  workspaceName?: string;
  brandName?: string | null;
  brandLogoUrl?: string | null;
  adminEmail?: string;
  adminPassword?: string;
  upsert?: boolean;
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

function normalizeOptionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeBrandLogoUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  let normalized = value.trim();
  if (!normalized) return null;

  normalized = normalized.replace(/\\/g, "/");

  // Allow absolute URLs for hosted assets.
  if (/^https?:\/\//i.test(normalized)) return normalized;

  // Callers sometimes pass filesystem-style public paths; normalize to web root.
  if (normalized.startsWith("public/")) normalized = normalized.slice("public".length);

  // Ensure a web-root-relative path for Next.js `public/` assets.
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;

  return normalized === "/" ? null : normalized;
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

  const body = (await request.json().catch(() => null)) as BootstrapWorkspaceRequest | null;
  const workspaceName = normalizeOptionalString(body?.workspaceName) ?? "";
  const adminEmail = (normalizeOptionalString(body?.adminEmail) ?? "").toLowerCase();
  const adminPassword = normalizeOptionalString(body?.adminPassword) ?? "";
  const upsert = body?.upsert === true;
  const brandName = normalizeOptionalNullableString(body?.brandName);
  const brandLogoUrl = normalizeBrandLogoUrl(normalizeOptionalNullableString(body?.brandLogoUrl));

  if (!workspaceName) {
    return NextResponse.json({ error: "workspaceName is required" }, { status: 400 });
  }

  if (!adminEmail) {
    return NextResponse.json({ error: "adminEmail is required" }, { status: 400 });
  }

  if (adminPassword && adminPassword.length < 6) {
    return NextResponse.json(
      { error: "adminPassword must be at least 6 characters" },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();

  const existingUserId = await resolveSupabaseUserIdByEmail(adminEmail);
  let userId = existingUserId;

  if (!userId) {
    if (!adminPassword) {
      return NextResponse.json(
        { error: "adminPassword is required to create a new user" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message, code: (error as any).code },
        { status: typeof error.status === "number" ? error.status : 500 }
      );
    }

    userId = data.user?.id ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
  } else if (adminPassword) {
    // Do not reset passwords unless the caller explicitly opts into upsert behavior.
    if (!upsert) {
      return NextResponse.json(
        { error: "User already exists; set upsert=true to reset password" },
        { status: 409 }
      );
    }

    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: adminPassword,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message, code: (error as any).code },
        { status: typeof error.status === "number" ? error.status : 500 }
      );
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existingWorkspace = await tx.client.findFirst({
        where: { userId, name: workspaceName },
        select: { id: true },
      });
      const existedWorkspace = Boolean(existingWorkspace);

      if (existingWorkspace && !upsert) {
        return { existed: true as const, workspaceId: existingWorkspace.id };
      }

      const workspace = existingWorkspace
        ? await tx.client.update({
            where: { id: existingWorkspace.id },
            data: { name: workspaceName },
            select: { id: true, name: true, userId: true },
          })
        : await tx.client.create({
            data: {
              name: workspaceName,
              userId,
              ghlLocationId: null,
              ghlPrivateKey: null,
            },
            select: { id: true, name: true, userId: true },
          });

      const settingsUpdate: Prisma.WorkspaceSettingsUpdateInput = {};
      if (brandName !== undefined) settingsUpdate.brandName = brandName;
      if (brandLogoUrl !== undefined) settingsUpdate.brandLogoUrl = brandLogoUrl;

      await tx.workspaceSettings.upsert({
        where: { clientId: workspace.id },
        create: {
          clientId: workspace.id,
          brandName: brandName ?? null,
          brandLogoUrl: brandLogoUrl ?? null,
        },
        update: settingsUpdate,
      });

      const reactivationCount = await tx.reactivationCampaign.count({
        where: { clientId: workspace.id },
      });

      if (reactivationCount === 0) {
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
      }

      return { existed: existedWorkspace, workspaceId: workspace.id };
    });

    return NextResponse.json(
      {
        success: true,
        existedUser: !!existingUserId,
        existedWorkspace: result.existed,
        userId,
        workspaceId: result.workspaceId,
      },
      { status: result.existed ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Workspace already exists (unique constraint)" },
        { status: 409 }
      );
    }

    console.error("[Workspace Bootstrap] error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Failed to bootstrap workspace" },
      { status: 500 }
    );
  }
}
