import "server-only";

import type { InboundPostProcessAdapter } from "@/lib/inbound-post-process/types";

export const instantlyInboundPostProcessAdapter: InboundPostProcessAdapter = {
  channel: "email",
  provider: "instantly",
  logPrefix: "[Instantly Post-Process]",
};

