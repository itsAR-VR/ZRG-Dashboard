import { createClient } from "@supabase/supabase-js";

import { redisGetJson, redisSetJson } from "@/lib/redis";

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

  const startedAt = Date.now();
  const uniqueIds = [...new Set(userIds)].filter((id) => typeof id === "string" && id.trim().length > 0);
  if (uniqueIds.length === 0) return result;

  const cachePrefix = "supabase:v1:user-email:";
  const cacheTtlSeconds = 60 * 60 * 6; // 6h; emails rarely change but avoid indefinite staleness.
  const negativeCacheTtlSeconds = 60 * 15; // 15m; avoid long-lived misses for newly created/updated users.

  const cached = await Promise.all(
    uniqueIds.map(async (id) => {
      const value = await redisGetJson<{ email: string | null }>(`${cachePrefix}${id}`);
      return { id, value };
    })
  );

  const missing: string[] = [];
  for (const entry of cached) {
    if (entry.value && typeof entry.value === "object" && "email" in entry.value) {
      result.set(entry.id, entry.value.email ?? null);
    } else {
      missing.push(entry.id);
    }
  }

  if (missing.length === 0) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= 500) {
      console.warn("[Supabase Admin] getSupabaseUserEmailsByIds slow-cache-hit", JSON.stringify({ ids: uniqueIds.length, elapsedMs }));
    }
    return result;
  }

  const updateCache = async (id: string, email: string | null) => {
    const ttlSeconds = email ? cacheTtlSeconds : negativeCacheTtlSeconds;
    await redisSetJson(`${cachePrefix}${id}`, { email }, { exSeconds: ttlSeconds });
  };

  const supabase = createSupabaseAdminClient();
  const admin: any = supabase.auth.admin as any;

  if (typeof admin.getUserById === "function") {
    // Prefer direct lookups to avoid paging through all users (which is highly variable under load).
    const concurrency = 8;
    let errorCount = 0;
    for (let offset = 0; offset < missing.length; offset += concurrency) {
      const batch = missing.slice(offset, offset + concurrency);
      const responses = await Promise.allSettled(
        batch.map(async (id) => {
          const { data, error } = await admin.getUserById(id);
          if (error) return { id, email: null, cacheable: false };
          return { id, email: (data?.user?.email ?? null) as string | null, cacheable: true };
        })
      );

      for (const response of responses) {
        if (response.status !== "fulfilled") {
          errorCount += 1;
          continue;
        }

        result.set(response.value.id, response.value.email);
        if (response.value.cacheable) {
          void updateCache(response.value.id, response.value.email);
        } else {
          errorCount += 1;
        }
      }
    }

    // Fill in nulls for any IDs not found due to errors/rejections.
    for (const id of missing) {
      if (!result.has(id)) result.set(id, null);
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= 500) {
      console.warn(
        "[Supabase Admin] getSupabaseUserEmailsByIds slow-getUserById",
        JSON.stringify({ cached: uniqueIds.length - missing.length, fetched: missing.length, errors: errorCount, elapsedMs })
      );
    }

    return result;
  }

  // Legacy fallback: page through users and collect matches. This can be extremely slow in large projects.
  // Keep it as a compatibility path only.
  const targetIds = new Set(missing);
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
        const email = (user.email ?? null) as string | null;
        result.set(user.id, email);
        void updateCache(user.id, email);
        foundCount++;
        // Early exit if all found
        if (foundCount >= missing.length) {
          const elapsedMs = Date.now() - startedAt;
          if (elapsedMs >= 500) {
            console.warn(
              "[Supabase Admin] getSupabaseUserEmailsByIds slow-listUsers",
              JSON.stringify({ cached: uniqueIds.length - missing.length, fetched: missing.length, pages: page, elapsedMs })
            );
          }
          return result;
        }
      }
    }

    if ((data.users || []).length < perPage) break;
  }

  // Fill in nulls for any IDs not found and negative-cache them.
  for (const id of missing) {
    if (!result.has(id)) {
      result.set(id, null);
      void updateCache(id, null);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= 500) {
    console.warn(
      "[Supabase Admin] getSupabaseUserEmailsByIds slow-listUsers-exhausted",
      JSON.stringify({ cached: uniqueIds.length - missing.length, fetched: missing.length, elapsedMs })
    );
  }

  return result;
}
