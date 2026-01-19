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

/**
 * Batch fetch emails for multiple user IDs in a single operation.
 * Much more efficient than calling getSupabaseUserEmailById in a loop.
 * Fetches all users once and returns a Map of userId -> email.
 */
export async function getSupabaseUserEmailsByIds(userIds: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (userIds.length === 0) return result;

  const uniqueIds = [...new Set(userIds)];
  const supabase = createSupabaseAdminClient();
  const admin: any = supabase.auth.admin as any;

  // Build a set for O(1) lookups
  const targetIds = new Set(uniqueIds);
  let foundCount = 0;

  // Page through all users and collect matches
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) {
      console.error("[Supabase Admin] listUsers error:", error);
      break;
    }

    for (const user of data.users || []) {
      if (targetIds.has(user.id)) {
        result.set(user.id, user.email ?? null);
        foundCount++;
        // Early exit if all found
        if (foundCount >= uniqueIds.length) {
          return result;
        }
      }
    }

    if ((data.users || []).length < perPage) break;
  }

  // Fill in nulls for any IDs not found
  for (const id of uniqueIds) {
    if (!result.has(id)) {
      result.set(id, null);
    }
  }

  return result;
}

