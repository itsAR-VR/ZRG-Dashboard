/**
 * Rebase + patch the Email Step 3 verifier prompt override for pricing hallucinations.
 *
 * Why this exists:
 * - Prompt overrides are protected by `baseContentHash` (flat drift model).
 * - When the code-default Step 3 system prompt changes, existing overrides stop applying until re-saved.
 * - Founders Club uses a workspace override for `draft.verify.email.step3.v1` with additional custom rules
 *   that must be preserved while upgrading the pricing validation rule.
 *
 * Run (dry-run, default):
 *   node --import tsx scripts/rebase-email-step3-pricing-override.ts
 *
 * Run (apply DB update):
 *   node --import tsx scripts/rebase-email-step3-pricing-override.ts --apply
 *
 * Options:
 *   --client-id <uuid>   (default: Founders Club clientId)
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const DEFAULT_FC_CLIENT_ID = "ef824aca-a3c9-4cde-b51f-2e421ebb6b6e";
const PROMPT_REGISTRY_PATH = path.join(process.cwd(), "lib/ai/prompt-registry.ts");

type CliOptions = {
  clientId: string;
  apply: boolean;
};

function parseFlagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const next = args[index + 1];
  return typeof next === "string" && !next.startsWith("--") ? next : null;
}

function parseOptions(): CliOptions {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const clientId = parseFlagValue(args, "--client-id") || DEFAULT_FC_CLIENT_ID;
  return { clientId, apply };
}

function patchStep3PricingRule(existing: string): { next: string; changed: boolean; reason?: string } {
  const pricingRuleLineRegex = /^\s*-\s*For pricing\/fees:.*$/m;
  const replacement =
    `- PRICING VALIDATION: If the draft includes any dollar amount that implies pricing (price/fee/cost/membership/investment, per month/year, /mo, /yr), the numeric dollar amount MUST match an explicit price/fee/cost in <service_description> only. Ignore <knowledge_context> for pricing validation. If an amount does not match, replace it with the best supported price from <service_description>. If multiple supported prices exist, match cadence (monthly vs annual); if cadence is unclear, include both supported options. If no explicit pricing exists in <service_description>, remove all dollar amounts and ask one clarifying pricing question with a quick-call next step. Treat negated unsupported amounts (for example, "not $3,000") as unsupported and remove/replace them too. Ignore revenue/funding thresholds (e.g., "$1M+ in revenue", "$2.5M raised", "$50M ARR") and do NOT treat them as pricing.`;

  if (pricingRuleLineRegex.test(existing)) {
    return { next: existing.replace(pricingRuleLineRegex, replacement), changed: true };
  }

  // Fallback: if the old line is already gone (manually edited), no-op safely.
  if (existing.includes("PRICING VALIDATION:")) {
    return { next: existing, changed: false, reason: "pricing_rule_already_patched" };
  }

  return { next: existing, changed: false, reason: "pricing_rule_not_found" };
}

function hashPromptContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function getCurrentStep3SystemContent(): string | null {
  const source = readFileSync(PROMPT_REGISTRY_PATH, "utf8");
  const match = source.match(/const EMAIL_DRAFT_VERIFY_STEP3_SYSTEM = `([\s\S]*?)`;\n/);
  return match?.[1] ?? null;
}

async function main() {
  const opts = parseOptions();
  const promptKey = "draft.verify.email.step3.v1";
  const role = "system";
  const index = 0;

  const currentSystemContent = getCurrentStep3SystemContent();
  if (!currentSystemContent) {
    console.error(`[rebase-step3] Failed to extract Step 3 system content from ${PROMPT_REGISTRY_PATH}`);
    process.exit(1);
  }

  const baseContentHash = hashPromptContent(currentSystemContent);
  if (!baseContentHash) {
    console.error(`[rebase-step3] Failed to hash Step 3 system content for ${promptKey} ${role}[${index}]`);
    process.exit(1);
  }

  const existing = await prisma.promptOverride.findUnique({
    where: {
      clientId_promptKey_role_index: {
        clientId: opts.clientId,
        promptKey,
        role,
        index,
      },
    },
    select: { id: true, content: true, baseContentHash: true },
  });

  if (!existing) {
    console.error(`[rebase-step3] No PromptOverride found (clientId=${opts.clientId}, promptKey=${promptKey}, ${role}[${index}])`);
    process.exit(1);
  }

  const patched = patchStep3PricingRule(existing.content);
  console.log(
    `[rebase-step3] clientId=${opts.clientId} promptKey=${promptKey} ${role}[${index}] ` +
      `apply=${opts.apply} baseHash(old=${existing.baseContentHash} new=${baseContentHash}) patchChanged=${patched.changed}` +
      (patched.reason ? ` reason=${patched.reason}` : "")
  );

  if (patched.reason === "pricing_rule_not_found") {
    console.error(
      `[rebase-step3] Pricing rule line not found in override content. Refusing to mutate to avoid corrupting custom rules.`
    );
    process.exit(1);
  }

  if (!opts.apply) {
    console.log("[rebase-step3] dry-run complete (no changes applied)");
    return;
  }

  const saved = await prisma.promptOverride.update({
    where: {
      clientId_promptKey_role_index: {
        clientId: opts.clientId,
        promptKey,
        role,
        index,
      },
    },
    data: {
      baseContentHash,
      content: patched.next,
    },
    select: { id: true },
  });

  await prisma.promptOverrideRevision.create({
    data: {
      clientId: opts.clientId,
      promptOverrideId: saved.id,
      promptKey,
      role,
      index,
      baseContentHash,
      content: patched.next,
      action: "UPSERT",
      createdByEmail: "script:rebase-email-step3-pricing-override",
    },
  });

  console.log("[rebase-step3] applied (override rebased + revision recorded)");
}

main().catch((error) => {
  console.error("[rebase-step3] failed:", error);
  process.exit(1);
});
