import "server-only";

import { processResponseTimingEvents } from "@/lib/response-timing/processor";

export async function runResponseTimingCron() {
  return processResponseTimingEvents();
}
