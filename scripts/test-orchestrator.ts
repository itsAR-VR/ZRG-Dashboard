import { spawn } from "node:child_process";

const TEST_FILES = [
  "lib/auto-send/__tests__/orchestrator.test.ts",
  "lib/__tests__/auto-send-optimization-context.test.ts",
  "lib/__tests__/auto-send-revision-agent.test.ts",
  "lib/__tests__/calendly-invitee-questions.test.ts",
  "lib/__tests__/booking-target-selector.test.ts",
  "lib/__tests__/ghl-appointment-response.test.ts",
  "lib/__tests__/appointment-reconcile-eligibility.test.ts",
  "lib/__tests__/phone-normalization.test.ts",
  "lib/__tests__/followup-template.test.ts",
  "lib/__tests__/followups-cron-overlap-lock.test.ts",
  "lib/__tests__/background-jobs-cron-no-advisory-lock.test.ts",
  "lib/__tests__/followups-backstop.test.ts",
  "lib/__tests__/insights-thread-extractor-schema.test.ts",
  "lib/__tests__/email-cleaning.test.ts",
  "lib/__tests__/email-participants.test.ts",
  "lib/__tests__/manual-draft-generation.test.ts",
  "lib/__tests__/ai-drafts-service-description-merge.test.ts",
  "lib/__tests__/ai-drafts-pricing-placeholders.test.ts",
  "lib/__tests__/prompt-system-defaults.test.ts",
  "lib/__tests__/prompt-runner-temperature-reasoning.test.ts",
  "lib/__tests__/prompt-runner-attempt-expansion.test.ts",
  "lib/__tests__/openai-telemetry-metadata.test.ts",
  "lib/__tests__/emailbison-stop-future-emails.test.ts",
  "lib/__tests__/emailbison-reply-payload.test.ts",
  "lib/__tests__/emailbison-deeplink.test.ts",
  "lib/__tests__/admin-actions-auth.test.ts",
  "lib/__tests__/workspace-access-super-admin.test.ts",
  "lib/__tests__/auto-send-evaluator-input.test.ts",
  "lib/__tests__/knowledge-asset-context.test.ts",
  "lib/__tests__/lead-context-bundle.test.ts",
  "lib/__tests__/memory-governance.test.ts",
  "lib/__tests__/draft-pipeline-retention-cron.test.ts",
  "lib/__tests__/confidence-policy.test.ts",
  "lib/__tests__/meeting-overseer-slot-selection.test.ts",
  "lib/__tests__/availability-format.test.ts",
  "lib/__tests__/reactivation-sequence-prereqs.test.ts",
  "lib/__tests__/response-disposition-idempotent.test.ts",
  "lib/__tests__/followup-engine-disposition.test.ts",
  "lib/__tests__/followup-booking-gate-retry.test.ts",
  "lib/__tests__/followup-engine-dayonly-slot.test.ts",
  "lib/__tests__/followup-booking-signal.test.ts",
  "lib/__tests__/followup-generic-acceptance.test.ts",
  "lib/__tests__/ai-ops-feed.test.ts",
  "lib/__tests__/analytics-windowing-stable.test.ts",
  "lib/__tests__/ai-draft-booking-conversion-windowing.test.ts",
  "lib/__tests__/response-timing.test.ts",
  "lib/__tests__/response-timing-analytics.test.ts",
  "lib/__tests__/calendar-capacity-metrics.test.ts",
  "lib/__tests__/prisma-appointment-calendar-fields.test.ts",
  "lib/__tests__/send-outcome-unknown-recovery.test.ts",
  "lib/__tests__/stale-sending-recovery.test.ts",
  "lib/__tests__/workspace-capabilities.test.ts",
  "lib/__tests__/lead-assignment.test.ts",
  "lib/__tests__/crm-sheet.test.ts",
  "lib/__tests__/workspace-member-provisioning.test.ts",
  "lib/__tests__/availability-refresh-ai.test.ts",
  "lib/__tests__/availability-refresh-candidates.test.ts",
  "lib/__tests__/offered-slots-refresh.test.ts",
  "lib/ai-drafts/__tests__/step3-verifier.test.ts",
  "lib/ai-drafts/__tests__/step3-guardrail.test.ts",
  "lib/ai-drafts/__tests__/response-disposition.test.ts",
];

async function main(): Promise<void> {
  const args = ["--conditions=react-server", "--import", "tsx", "--test", ...TEST_FILES];

  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      // Many modules import `lib/prisma.ts` which initializes Prisma at module-load time.
      // Unit tests mock DB access, but we still need syntactically valid URLs so imports
      // don't throw when DATABASE_URL/DIRECT_URL aren't set in the test environment.
      DATABASE_URL:
        process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public",
      DIRECT_URL: process.env.DIRECT_URL || "postgresql://test:test@localhost:5432/test?schema=public",
      // `lib/ai/openai-client.ts` constructs the OpenAI client at import-time.
      // Unit tests mock the downstream callers, but we still need a non-empty key
      // to avoid the OpenAI SDK throwing during module initialization.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "test",
    },
  });

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[test] Failed:", error);
  process.exit(1);
});
