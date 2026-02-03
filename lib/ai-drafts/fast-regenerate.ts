import "server-only";

import { prisma } from "@/lib/prisma";
import { runTextPrompt } from "@/lib/ai/prompt-runner";
import { withAiTelemetrySourceIfUnset } from "@/lib/ai/telemetry-context";
import { buildEffectiveEmailLengthRules, getEffectiveArchetypeInstructions, getEffectiveForbiddenTerms } from "@/lib/ai/prompt-snippets";
import { EMAIL_DRAFT_STRUCTURE_ARCHETYPES, getArchetypeById, type EmailDraftArchetype } from "@/lib/ai-drafts/config";
import { sanitizeDraftContent } from "@/lib/ai-drafts";
import { enforceCanonicalBookingLink, replaceEmDashesWithCommaSpace } from "@/lib/ai-drafts/step3-verifier";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import { detectBounce, isOptOutText } from "@/lib/sentiment";

export type FastRegenChannel = "sms" | "email" | "linkedin";

const DEFAULT_FAST_REGEN_TIMEOUT_MS = 20_000;
const DEFAULT_FAST_REGEN_MODEL = "gpt-5-mini";

export const FAST_REGEN_CHAR_LIMITS = {
  sms: 320,
  linkedin: 800,
} as const;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function stableHash32(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // to 32-bit
  }
  return hash;
}

export function pickCycledEmailArchetypeId(opts: {
  cycleSeed: string;
  /** 0-based; each increment should produce a different archetype (wraps at 10). */
  regenCount: number;
}): string {
  const seed = (opts.cycleSeed || "").trim();
  const regenCount = clampInt(opts.regenCount, 0, 1000);

  const archetypes = EMAIL_DRAFT_STRUCTURE_ARCHETYPES;
  if (archetypes.length === 0) return "A1_short_paragraph_bullets_question";

  const baseIndex = Math.abs(stableHash32(seed)) % archetypes.length;
  const targetIndex = (baseIndex + regenCount + 1) % archetypes.length;
  return archetypes[targetIndex].id;
}

async function resolveEmailArchetype(opts: { clientId: string; archetypeId: string }): Promise<EmailDraftArchetype> {
  const fallback = EMAIL_DRAFT_STRUCTURE_ARCHETYPES[0];
  const base = getArchetypeById(opts.archetypeId) ?? fallback;
  const { instructions } = await getEffectiveArchetypeInstructions(base.id, opts.clientId);
  return { ...base, instructions };
}

function clampTextMaxChars(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trimEnd();
}

export function clampFastRegenOutputForChannel(text: string, channel: FastRegenChannel): string {
  if (channel === "sms") return clampTextMaxChars(text, FAST_REGEN_CHAR_LIMITS.sms);
  if (channel === "linkedin") return clampTextMaxChars(text, FAST_REGEN_CHAR_LIMITS.linkedin);
  return text.trim();
}

function getFastRegenModel(): string {
  const raw = (process.env.OPENAI_FAST_REGEN_MODEL || DEFAULT_FAST_REGEN_MODEL).trim();
  return raw || DEFAULT_FAST_REGEN_MODEL;
}

function trimContextForPrompt(text: string, maxChars: number): string {
  const cleaned = (text || "").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars).trimEnd();
}

function isUnsafeToRespond(text: string, channel: FastRegenChannel): boolean {
  const combined = (text || "").trim();
  if (!combined) return false;
  if (isOptOutText(combined)) return true;
  if (channel === "email" && detectBounce([{ body: combined, direction: "inbound", channel: "email" }])) return true;
  return false;
}

export async function fastRegenerateDraftContent(opts: {
  clientId: string;
  leadId: string;
  channel: FastRegenChannel;
  sentimentTag: string;
  previousDraft: string;
  latestInbound?: { subject?: string | null; body: string } | null;
  /**
   * Email-only. If omitted, caller must provide `cycleSeed` + `regenCount`.
   * (We keep the selection logic explicit so UI/Slack can deterministically cycle.)
   */
  archetypeId?: string;
  /** Email-only (when archetypeId omitted). */
  cycleSeed?: string;
  /** Email-only (when archetypeId omitted). */
  regenCount?: number;
  /**
   * Lead explicitly provided their own scheduling link.
   * When present, we must not offer our times or our booking link.
   */
  leadSchedulerLink?: string | null;
  timeoutMs?: number;
}): Promise<{ success: boolean; content?: string; error?: string }> {
  return withAiTelemetrySourceIfUnset(`lib:draft.fast_regen.${opts.channel}`, async () => {
    const timeoutMs = clampInt(opts.timeoutMs ?? DEFAULT_FAST_REGEN_TIMEOUT_MS, 5_000, 120_000);
    const previousDraft = (opts.previousDraft || "").trim();
    const latestInboundBody = (opts.latestInbound?.body || "").trim();
    const latestInboundSubject = (opts.latestInbound?.subject || "").trim();
    const leadSchedulerLink = (opts.leadSchedulerLink || "").trim() || null;

    if (!previousDraft) return { success: false, error: "Missing previous draft" };

    // Safety: if we see opt-out/bounce signals, produce an empty draft.
    const safetyText = [
      latestInboundSubject && `Subject: ${latestInboundSubject}`,
      latestInboundBody,
      previousDraft,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (isUnsafeToRespond(safetyText, opts.channel)) {
      return { success: true, content: "" };
    }

    const model = getFastRegenModel();

    try {
      if (opts.channel === "email") {
        const archetypeId =
          typeof opts.archetypeId === "string" && opts.archetypeId.trim()
            ? opts.archetypeId.trim()
            : pickCycledEmailArchetypeId({
                cycleSeed: (opts.cycleSeed || "").trim() || opts.leadId,
                regenCount: clampInt(opts.regenCount ?? 0, 0, 1000),
              });

        const [archetype, { terms: forbiddenTerms }, { rules: emailLengthRules, bounds: emailLengthBounds }] =
          await Promise.all([
            resolveEmailArchetype({ clientId: opts.clientId, archetypeId }),
            getEffectiveForbiddenTerms(opts.clientId),
            buildEffectiveEmailLengthRules(opts.clientId),
          ]);

        const schedulerSection = leadSchedulerLink
          ? `\nLEAD-PROVIDED SCHEDULING LINK:\n${leadSchedulerLink}\nIMPORTANT: Do NOT offer our availability times or our booking link. Acknowledge their scheduler (no need to paste the full URL).`
          : "";

        const instructions =
          `You are an inbox manager. Rewrite the EMAIL REPLY below to be a better response.\n\n` +
          `TARGET STRUCTURE ARCHETYPE: \"${archetype.name}\"\n${archetype.instructions}\n\n` +
          `OUTPUT RULES:\n` +
          `- Output ONLY the rewritten email reply (no preface).\n` +
          `- Do NOT include a subject line.\n` +
          `- Output Markdown-friendly plain text (paragraphs and \"-\" bullets allowed).\n` +
          `- Do not use bold, italics, underline, strikethrough, code blocks, or headings.\n` +
          `- Preserve meaning, factual details, and CTA.\n` +
          `- Preserve any full URLs EXACTLY as-is. Do not add new URLs.\n` +
          `- If the original includes offered times, keep those offered times verbatim (do not invent new times).\n` +
          `- Never imply a meeting is booked unless explicitly confirmed by the lead.\n` +
          `- Do not invent facts. Use only the provided context.\n` +
          `- If the lead opted out/unsubscribed/asked to stop or this is a bounce, output an empty reply (\"\") and nothing else.\n\n` +
          `FORBIDDEN TERMS (never use):\n${forbiddenTerms.slice(0, 50).join(", ")}\n` +
          schedulerSection +
          emailLengthRules;

        const latestInboundSection =
          latestInboundSubject || latestInboundBody
            ? `<latest_inbound>\n${trimContextForPrompt(
                `${latestInboundSubject ? `Subject: ${latestInboundSubject}\n\n` : ""}${latestInboundBody}`,
                2000
              )}\n</latest_inbound>\n\n`
            : "";

        const input = `${latestInboundSection}<previous_draft>\n${previousDraft}\n</previous_draft>\n\n<task>\nRewrite the email now.\n</task>`;

        const result = await runTextPrompt({
          pattern: "text",
          clientId: opts.clientId,
          leadId: opts.leadId,
          featureId: "draft.fast_regen.email",
          promptKey: `draft.fast_regen.email.v1.arch_${archetype.id}`,
          model,
          reasoningEffort: "minimal",
          systemFallback: instructions,
          input: [{ role: "user" as const, content: input }],
          temperature: 0.7,
          maxOutputTokens: 1200,
          timeoutMs,
          maxRetries: 0,
          resolved: {
            system: instructions,
            featureId: "draft.fast_regen.email",
            promptKeyForTelemetry: `draft.fast_regen.email.v1.arch_${archetype.id}`,
          },
        });

        if (!result.success) {
          return { success: false, error: result.error.message };
        }

        let content = result.data.trim();

        // Post-processing: keep deterministic and fast.
        content = sanitizeDraftContent(content, opts.leadId, "email");
        content = replaceEmDashesWithCommaSpace(content);

        // Booking link enforcement (unless lead provided their own scheduler link).
        try {
          const settings = await prisma.workspaceSettings.findUnique({
            where: { clientId: opts.clientId },
            select: { meetingBookingProvider: true, calendlyEventTypeLink: true },
          });

          const resolved = await resolveBookingLink(opts.clientId, settings);
          const bookingLink = leadSchedulerLink ? null : resolved.bookingLink;

          content = enforceCanonicalBookingLink(content, bookingLink, {
            replaceAllUrls: !leadSchedulerLink && resolved.hasPublicOverride,
          });

          // If the lead has their own scheduler, hard-remove our canonical link if it appears anyway.
          if (leadSchedulerLink && resolved.bookingLink) {
            content = content.replaceAll(resolved.bookingLink, "").replace(/[ \t]{2,}/g, " ").trim();
          }
        } catch (error) {
          console.warn("[FastRegen] Booking link enforcement failed:", error);
        }

        // Clamp to configured bounds (last line of defense).
        if (content.trim().length > emailLengthBounds.maxChars) {
          content = content.trim().slice(0, emailLengthBounds.maxChars).trimEnd();
        }

        return { success: true, content };
      }

      // SMS / LinkedIn (rewrite-only)
      const maxChars = opts.channel === "sms" ? FAST_REGEN_CHAR_LIMITS.sms : FAST_REGEN_CHAR_LIMITS.linkedin;

      const channelLabel = opts.channel.toUpperCase();
      const instructions =
        `You are an inbox manager. Rewrite the ${channelLabel} reply below.\n\n` +
        `OUTPUT RULES:\n` +
        `- Output ONLY the rewritten reply (no preface).\n` +
        `- Keep the same meaning and CTA.\n` +
        `- Be concise.\n` +
        `- Preserve any full URLs EXACTLY as-is. Do not add new URLs.\n` +
        `- Do not invent facts.\n` +
        `- Keep under ${maxChars} characters.\n`;

      const input =
        (latestInboundBody
          ? `<latest_inbound>\n${trimContextForPrompt(latestInboundBody, 1200)}\n</latest_inbound>\n\n`
          : "") +
        `<previous_draft>\n${previousDraft}\n</previous_draft>\n\n<task>\nRewrite the reply now.\n</task>`;

      const result = await runTextPrompt({
        pattern: "text",
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: `draft.fast_regen.${opts.channel}`,
        promptKey: `draft.fast_regen.${opts.channel}.v1`,
        model,
        reasoningEffort: "minimal",
        systemFallback: instructions,
        input: [{ role: "user" as const, content: input }],
        temperature: 0.8,
        maxOutputTokens: 400,
        timeoutMs,
        maxRetries: 0,
        resolved: {
          system: instructions,
          featureId: `draft.fast_regen.${opts.channel}`,
          promptKeyForTelemetry: `draft.fast_regen.${opts.channel}.v1`,
        },
      });

      if (!result.success) {
        return { success: false, error: result.error.message };
      }

      let content = result.data.trim();
      content = sanitizeDraftContent(content, opts.leadId, opts.channel);
      content = clampFastRegenOutputForChannel(content, opts.channel);
      return { success: true, content };
    } catch (error) {
      console.error("[FastRegen] Failed:", error);
      return { success: false, error: error instanceof Error ? error.message : "Fast regeneration failed" };
    }
  });
}
