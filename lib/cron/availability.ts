import "server-only";

import { refreshAvailabilityCachesDue } from "@/lib/availability-cache";

export async function runAvailabilityCron(searchParams: URLSearchParams, invocationId: string) {
  const timeBudgetMsParam = searchParams.get("timeBudgetMs");
  const fromQuery = timeBudgetMsParam ? Number.parseInt(timeBudgetMsParam, 10) : null;
  const fromEnv = process.env.AVAILABILITY_CRON_TIME_BUDGET_MS
    ? Number.parseInt(process.env.AVAILABILITY_CRON_TIME_BUDGET_MS, 10)
    : null;
  const maxBudgetMs = 10 * 60_000;
  const overallBudgetMs = Number.isFinite(fromQuery)
    ? Math.max(10_000, Math.min(maxBudgetMs, fromQuery as number))
    : Number.isFinite(fromEnv)
      ? Math.max(10_000, Math.min(maxBudgetMs, fromEnv as number))
      : 55_000;

  const concurrencyParam = searchParams.get("concurrency");
  const concurrency = concurrencyParam ? Number.parseInt(concurrencyParam, 10) : undefined;

  const defaultBudgetMs = Math.max(10_000, Math.floor(overallBudgetMs * 0.75));
  const directBudgetMs = Math.max(0, overallBudgetMs - defaultBudgetMs);

  const defaultResult = await refreshAvailabilityCachesDue({
    mode: "all",
    timeBudgetMs: defaultBudgetMs,
    concurrency,
    invocationId,
    availabilitySource: "DEFAULT",
  });

  const directBookResult =
    directBudgetMs >= 10_000
      ? await refreshAvailabilityCachesDue({
          mode: "all",
          timeBudgetMs: directBudgetMs,
          concurrency,
          invocationId,
          availabilitySource: "DIRECT_BOOK",
        })
      : null;

  return {
    default: defaultResult,
    directBook: directBookResult,
  };
}
