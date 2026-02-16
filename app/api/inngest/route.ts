import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { inngestFunctions } from "@/lib/inngest/functions";

// Keep parity with long-running cron routes for larger background batches.
export const maxDuration = 800;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
