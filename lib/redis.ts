import { Redis } from "@upstash/redis";

let client: Redis | null = null;

function hasRedisEnv(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function getClient(): Redis | null {
  if (client) return client;
  if (!hasRedisEnv()) return null;

  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return client;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const redis = getClient();
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    return (value as T | null) ?? null;
  } catch {
    return null;
  }
}

export async function redisSetJson(
  key: string,
  value: unknown,
  opts: { exSeconds: number }
): Promise<void> {
  const redis = getClient();
  if (!redis) return;

  try {
    await redis.set(key, value, { ex: opts.exSeconds });
  } catch {
    // ignore cache write errors
  }
}

export async function redisIncr(key: string): Promise<number | null> {
  const redis = getClient();
  if (!redis) return null;

  try {
    return await redis.incr(key);
  } catch {
    return null;
  }
}

