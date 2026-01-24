import "server-only";

import type { InboundPostProcessAdapter } from "@/lib/inbound-post-process/types";

export const smartLeadInboundPostProcessAdapter: InboundPostProcessAdapter = {
  channel: "email",
  provider: "smartlead",
  logPrefix: "[SmartLead Post-Process]",
};

