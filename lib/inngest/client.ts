import "server-only";

import { Inngest } from "inngest";

function resolveInngestEnv(): string | undefined {
  const explicit = process.env.INNGEST_ENV?.trim();
  if (explicit) return explicit;

  // In Vercel production deployments, default to the stable Inngest production env
  // instead of branch-derived env names (e.g. "main").
  if (process.env.VERCEL_ENV === "production") {
    return "production";
  }

  return undefined;
}

const env = resolveInngestEnv();

export const inngest = new Inngest({
  id: process.env.INNGEST_APP_ID?.trim() || "zrg-dashboard",
  ...(env ? { env } : {}),
});
