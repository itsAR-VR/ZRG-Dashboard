import "server-only";

import { getAIPromptTemplate, getPromptWithOverrides, type AIPromptTemplate } from "@/lib/ai/prompt-registry";
import { substituteTemplateVars } from "@/lib/ai/prompt-runner/template";
import type { ResolvedPromptMetadata } from "@/lib/ai/prompt-runner/types";

export type ResolvedPromptTemplate = ResolvedPromptMetadata & {
  template: AIPromptTemplate | null;
};

export async function resolvePromptTemplate(opts: {
  promptKey: string;
  clientId: string;
  systemFallback: string;
  templateVars?: Record<string, string>;
}): Promise<ResolvedPromptTemplate> {
  const overrideResult = await getPromptWithOverrides(opts.promptKey, opts.clientId).catch(() => null);
  const template = overrideResult?.template ?? getAIPromptTemplate(opts.promptKey);
  const overrideVersion = overrideResult?.overrideVersion ?? null;

  const systemTemplate =
    template?.messages.find((m) => m.role === "system")?.content || opts.systemFallback || `You are a helpful assistant.`;
  const system = substituteTemplateVars(systemTemplate, opts.templateVars);

  const featureId = template?.featureId || opts.promptKey;
  const templateKey = template?.key || opts.promptKey;
  const promptKeyForTelemetry = templateKey + (overrideVersion ? `.${overrideVersion}` : "");

  return { template, system, featureId, promptKeyForTelemetry };
}

