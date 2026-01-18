import "@/lib/server-dns";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Create adapter with connection string
const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Check if an error is a Prisma P2002 unique constraint violation.
 * Use this to handle race conditions in webhook deduplication.
 */
export function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "P2002";
}

/**
 * Check if an error is a Prisma P1001 "can't reach database server" error.
 * Use this to handle transient connection failures with retry logic.
 */
export function isPrismaConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "P1001";
}

/**
 * Retry a database operation on P1001 (connection error) with exponential backoff.
 * For use in cron jobs and background workers where transient DB outages should be tolerated.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelay = opts?.baseDelayMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isConnectionError = isPrismaConnectionError(error);

      if (isConnectionError && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        opts?.onRetry?.(attempt + 1, error instanceof Error ? error : new Error(String(error)));
        console.warn(`[DB] Connection error (P1001), retrying ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new Error("withDbRetry: unreachable");
}

export default prisma;
