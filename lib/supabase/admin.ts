import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Server misconfigured: missing Supabase admin env vars");
  }
  return { url, serviceRoleKey };
}

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = getSupabaseAdminEnv();
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export async function resolveSupabaseUserIdByEmail(emailRaw: string): Promise<string | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return null;

  const supabase = createSupabaseAdminClient();
  const perPage = 200;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[Supabase Admin] listUsers error:", error);
      throw new Error("Failed to look up user by email");
    }

    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < perPage) break;
  }

  return null;
}

export async function getSupabaseUserEmailById(userId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient();
  const admin: any = supabase.auth.admin as any;

  if (typeof admin.getUserById === "function") {
    const { data, error } = await admin.getUserById(userId);
    if (error) {
      console.error("[Supabase Admin] getUserById error:", error);
      return null;
    }
    return data?.user?.email ?? null;
  }

  // Fallback: page through users (slower, but avoids dependency on a specific supabase-js API surface).
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) {
      console.error("[Supabase Admin] listUsers error:", error);
      return null;
    }
    const found = (data.users || []).find((u: any) => u.id === userId);
    if (found) return (found.email ?? null) as string | null;
    if ((data.users || []).length < perPage) break;
  }

  return null;
}

