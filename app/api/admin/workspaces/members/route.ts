import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRouteSecret } from "@/lib/api-secret-auth";
import { createSupabaseAdminClient, resolveSupabaseUserIdByEmail } from "@/lib/supabase/admin";
import { ClientMemberRole, Prisma } from "@prisma/client";

export const maxDuration = 800;

type BootstrapWorkspaceMemberRequest = {
  // Workspace selector (prefer workspaceId; name requires owner email for disambiguation)
  workspaceId?: string;
  workspaceName?: string;
  workspaceOwnerEmail?: string;

  // Member to create/upsert
  memberEmail?: string;
  memberPassword?: string;
  role?: string;
  upsert?: boolean;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseRole(value: unknown): ClientMemberRole | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();

  if (normalized === ClientMemberRole.SETTER) return ClientMemberRole.SETTER;
  if (normalized === ClientMemberRole.INBOX_MANAGER) return ClientMemberRole.INBOX_MANAGER;
  if (normalized === ClientMemberRole.ADMIN) return ClientMemberRole.ADMIN;

  return null;
}

async function resolveWorkspace(params: {
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceOwnerEmail: string | null;
}): Promise<
  | { ok: true; workspaceId: string; workspaceName: string }
  | { ok: false; error: string; status: number; workspaceIds?: string[] }
> {
  if (params.workspaceId) {
    const workspace = await prisma.client.findUnique({
      where: { id: params.workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) return { ok: false, error: "Workspace not found for workspaceId", status: 404 };
    return { ok: true, workspaceId: workspace.id, workspaceName: workspace.name };
  }

  if (!params.workspaceName || !params.workspaceOwnerEmail) {
    return {
      ok: false,
      error: "Provide workspaceId, or workspaceName + workspaceOwnerEmail",
      status: 400,
    };
  }

  const ownerUserId = await resolveSupabaseUserIdByEmail(params.workspaceOwnerEmail);
  if (!ownerUserId) return { ok: false, error: "Workspace owner user not found for workspaceOwnerEmail", status: 404 };

  const matches = await prisma.client.findMany({
    where: { name: params.workspaceName, userId: ownerUserId },
    select: { id: true, name: true },
    take: 2,
  });

  if (matches.length === 0) return { ok: false, error: "Workspace not found for workspaceName + workspaceOwnerEmail", status: 404 };
  if (matches.length > 1) {
    return { ok: false, error: "Multiple workspaces matched; provide workspaceId", status: 409, workspaceIds: matches.map((m) => m.id) };
  }

  return { ok: true, workspaceId: matches[0].id, workspaceName: matches[0].name };
}

export async function POST(request: NextRequest) {
  const expectedSecret =
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.CRON_SECRET ??
    null;

  const auth = verifyRouteSecret({
    request,
    expectedSecret,
    allowQuerySecret: true,
    misconfiguredError: "Server misconfigured: set WORKSPACE_PROVISIONING_SECRET",
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => null)) as BootstrapWorkspaceMemberRequest | null;

    const workspaceId = normalizeOptionalString(body?.workspaceId) ?? null;
    const workspaceName = normalizeOptionalString(body?.workspaceName) ?? null;
    const workspaceOwnerEmail = (normalizeOptionalString(body?.workspaceOwnerEmail) ?? "").toLowerCase() || null;

    const memberEmail = (normalizeOptionalString(body?.memberEmail) ?? "").toLowerCase();
    const memberPassword = normalizeOptionalString(body?.memberPassword) ?? "";
    const upsert = body?.upsert === true;
    const role = parseRole(body?.role) ?? ClientMemberRole.SETTER;

    if (!memberEmail) {
      return NextResponse.json({ error: "memberEmail is required" }, { status: 400 });
    }

    if (memberPassword && memberPassword.length < 6) {
      return NextResponse.json({ error: "memberPassword must be at least 6 characters" }, { status: 400 });
    }

    const workspace = await resolveWorkspace({ workspaceId, workspaceName, workspaceOwnerEmail });
    if (!workspace.ok) {
      return NextResponse.json(
        { error: workspace.error, workspaceIds: workspace.workspaceIds },
        { status: workspace.status }
      );
    }

    const existingUserId = await resolveSupabaseUserIdByEmail(memberEmail);
    let userId = existingUserId;

    const supabase = createSupabaseAdminClient();

    if (!userId) {
      if (!memberPassword) {
        return NextResponse.json(
          { error: "memberPassword is required to create a new user" },
          { status: 400 }
        );
      }

      const { data, error } = await supabase.auth.admin.createUser({
        email: memberEmail,
        password: memberPassword,
        email_confirm: true,
      });

      if (error) {
        return NextResponse.json(
          { error: error.message, code: (error as any).code },
          { status: typeof error.status === "number" ? error.status : 500 }
        );
      }

      userId = data.user?.id ?? null;
      if (!userId) return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    } else if (memberPassword) {
      if (!upsert) {
        return NextResponse.json(
          { error: "User already exists; set upsert=true to reset password" },
          { status: 409 }
        );
      }

      const { error } = await supabase.auth.admin.updateUserById(userId, { password: memberPassword });

      if (error) {
        return NextResponse.json(
          { error: error.message, code: (error as any).code },
          { status: typeof error.status === "number" ? error.status : 500 }
        );
      }
    }

    let existedMembership = await prisma.clientMember
      .findFirst({
        where: { clientId: workspace.workspaceId, userId, role },
        select: { id: true },
      })
      .then(Boolean);

    let membershipCreated = false;

    if (!existedMembership) {
      try {
        await prisma.clientMember.create({
          data: {
            clientId: workspace.workspaceId,
            userId,
            role,
          },
        });
        membershipCreated = true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          // Concurrent create; treat as existed.
          existedMembership = true;
        } else {
          throw error;
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        existedUser: Boolean(existingUserId),
        existedMembership,
        userId,
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.workspaceName,
        role,
      },
      { status: membershipCreated ? 201 : 200 }
    );
  } catch (error) {
    console.error("[Workspace Member Bootstrap] error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to bootstrap workspace member" }, { status: 500 });
  }
}
