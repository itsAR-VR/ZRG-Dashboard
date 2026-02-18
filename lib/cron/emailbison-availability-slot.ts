import "server-only";

import { processEmailBisonFirstTouchAvailabilitySlots } from "@/lib/emailbison-first-touch-availability";

export async function runEmailBisonAvailabilitySlotCron(searchParams: URLSearchParams) {
  const dryRun = searchParams.get("dryRun") === "true";
  const timeBudgetMsParam = searchParams.get("timeBudgetMs");
  const timeBudgetMs = timeBudgetMsParam ? Number.parseInt(timeBudgetMsParam, 10) : undefined;

  return processEmailBisonFirstTouchAvailabilitySlots({
    dryRun,
    timeBudgetMs,
  });
}
