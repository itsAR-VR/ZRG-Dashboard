# Phase 31e — Reduce Insights Cron Database Pressure (Batching, Connection Handling)

## Focus
Address Prisma P1001 errors ("Can't reach database server") in the Insights Cron by optimizing database access patterns and connection handling.

## Inputs
- From 31d: User notifications are now in place for integration issues
- Error observed: `[Insights Cron] Error: Error [PrismaClientKnownRequestError]: Invalid prisma.insightContextPack.findMany() invocation: Can't reach database server at 3.151.242.123:6543`
- P1001 indicates connection pool exhaustion or network timeout
- Insights Cron in `/api/cron/insights/booked-summaries/route.ts` runs heavy queries + LLM calls
- Database connection: pgbouncer on port 6543 (transaction mode)

## Work

### 1. Analyze current Insights Cron database access
```typescript
// Current flow:
// 1. Find candidates: prisma.lead.findMany({ ... take: Math.max(limit * 3, 20) })
// 2. Filter by booking status
// 3. For each lead: extractConversationInsightForLead()
//    - prisma.lead.findUnique
//    - prisma.message.findMany
//    - LLM calls (hold connection while waiting?)
// 4. prisma.leadConversationInsight.upsert()
```

### 2. Identify connection pressure points
- **Long-held connections**: LLM calls take 30-120s; if connection is held during this, pool exhausts
- **Sequential processing**: Processing leads one-by-one holds connections longer than necessary
- **Large result sets**: `findMany` with large `take` values

### 3. Implement batch-and-release pattern
Don't hold DB connections during LLM calls:
```typescript
// Fetch all needed data upfront
const candidates = await prisma.lead.findMany({...});
const leadsWithMessages = await Promise.all(
  candidates.map(async (lead) => {
    const messages = await prisma.message.findMany({ where: { leadId: lead.id } });
    return { lead, messages };
  })
);

// Release connections, then do LLM work
for (const { lead, messages } of leadsWithMessages) {
  const insight = await extractInsightFromData(lead, messages); // LLM call, no DB

  // Quick DB write
  await prisma.leadConversationInsight.upsert({...});
}
```

### 4. Add connection timeout handling
Wrap DB calls with retry on P1001:
```typescript
async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; retryDelayMs?: number }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelay = opts?.retryDelayMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isP1001Error(error) && attempt < maxRetries) {
        console.warn(`[DB] Connection error, retrying (${attempt + 1}/${maxRetries})...`);
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unreachable");
}

function isP1001Error(error: unknown): boolean {
  return error instanceof Error && error.message.includes("P1001");
}
```

### 5. Reduce batch size and add concurrency limit
```typescript
// Environment-configurable batch size
const limit = Math.max(1, Math.min(
  10, // Cap at 10 to reduce pressure
  Number.parseInt(process.env.INSIGHTS_BOOKED_SUMMARIES_CRON_LIMIT || "5", 10) || 5
));

// Process with bounded concurrency
const CONCURRENCY = 2; // Max 2 LLM calls at once
await mapWithConcurrency(toProcess, CONCURRENCY, async (lead) => {
  // ... process lead ...
});
```

### 6. Add early exit on repeated connection failures
If we hit P1001 multiple times, exit gracefully:
```typescript
let connectionErrors = 0;
const MAX_CONNECTION_ERRORS = 3;

for (const lead of toProcess) {
  try {
    // ... process ...
  } catch (error) {
    if (isP1001Error(error)) {
      connectionErrors++;
      if (connectionErrors >= MAX_CONNECTION_ERRORS) {
        console.error("[Insights Cron] Too many connection errors, exiting early");
        break;
      }
    }
    // ... handle other errors ...
  }
}
```

### 7. Consider Prisma connection pool settings
If still hitting limits, adjust connection pool in `lib/prisma.ts`:
```typescript
// For serverless, keep pool small and timeout fast
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Log connection issues
  log: process.env.PRISMA_LOG_QUERIES === "true"
    ? ["query", "error", "warn"]
    : ["error", "warn"],
});
```

### 8. Monitor and document
- Add `[Insights Cron] Starting with limit=${limit}, concurrency=${CONCURRENCY}`
- Add `[Insights Cron] Completed: processed=${processed}, failed=${failed}, connectionErrors=${connectionErrors}`
- Document `INSIGHTS_BOOKED_SUMMARIES_CRON_LIMIT` in README

## Output

**SKIPPED - Superseded by 31i**

This subphase targeted `app/api/cron/insights/booked-summaries/route.ts` but per RED TEAM analysis (root plan.md), the observed P1001 errors reference `prisma.insightContextPack.findMany()` which is in `app/api/cron/insights/context-packs/route.ts`.

The correct implementation approach is in **31i** which:
- Targets the correct cron route (`context-packs`)
- Uses existing concurrency knobs (`INSIGHTS_CONTEXT_PACK_LEAD_CONCURRENCY`, etc.)
- Adds DB retry helper specifically for P1001

## Handoff
Skip to 31f. Insights Cron P1001 will be addressed in 31i at the correct touch point.
