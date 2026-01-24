import "server-only";

import { runInboundPostProcessPipeline } from "@/lib/inbound-post-process";
import { instantlyInboundPostProcessAdapter } from "@/lib/inbound-post-process/adapters/instantly";

export async function runInstantlyInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  await runInboundPostProcessPipeline({ ...params, adapter: instantlyInboundPostProcessAdapter });
}
