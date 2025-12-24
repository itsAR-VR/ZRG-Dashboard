import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SetPasswordRequest = {
  userId?: string;
  email?: string;
  password?: string;
};

function getBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function POST(request: NextRequest) {
  const expectedSecret =
    process.env.ADMIN_ACTIONS_SECRET ?? process.env.CRON_SECRET ?? null;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Server misconfigured: set ADMIN_ACTIONS_SECRET" },
      { status: 500 }
    );
  }

  const providedSecret = getBearerToken(request);
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SetPasswordRequest | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  if (!userId && !email) {
    return NextResponse.json(
      { error: "Provide either userId or email" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing Supabase env vars" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  let resolvedUserId = userId;

  if (!resolvedUserId) {
    // Supabase JS doesn't expose getUserByEmail; page through users until we find a match.
    const perPage = 200;
    for (let page = 1; page <= 50; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      });

      if (error) {
        console.error("[Admin Set Password] listUsers error:", error);
        return NextResponse.json(
          { error: "Failed to look up user" },
          { status: 500 }
        );
      }

      const found = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === email
      );
      if (found) {
        resolvedUserId = found.id;
        break;
      }

      if (data.users.length < perPage) break;
    }

    if (!resolvedUserId) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  }

  const { data, error } = await supabase.auth.admin.updateUserById(
    resolvedUserId,
    { password }
  );

  if (error) {
    console.error("[Admin Set Password] updateUserById error:", error);
    return NextResponse.json(
      { error: error.message, code: (error as any).code },
      { status: typeof error.status === "number" ? error.status : 500 }
    );
  }

  console.info("[Admin Set Password] password updated for user", {
    userId: data.user?.id ?? resolvedUserId,
  });

  return NextResponse.json({
    success: true,
    userId: data.user?.id ?? resolvedUserId,
  });
}

