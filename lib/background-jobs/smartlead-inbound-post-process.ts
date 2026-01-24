import "server-only";

import { runInboundPostProcessPipeline } from "@/lib/inbound-post-process";
import { smartLeadInboundPostProcessAdapter } from "@/lib/inbound-post-process/adapters/smartlead";

export async function runSmartLeadInboundPostProcessJob(params: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  await runInboundPostProcessPipeline({ ...params, adapter: smartLeadInboundPostProcessAdapter });
}
