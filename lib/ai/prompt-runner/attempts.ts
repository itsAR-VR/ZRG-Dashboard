import "server-only";

export function expandOutputTokenAttempts(opts: {
  attempts: number[];
  maxAttempts: number;
  multiplier: number;
  cap: number;
  retryExtraTokens?: number;
}): number[] {
  const out = [...opts.attempts];

  const extraTokensRaw = typeof opts.retryExtraTokens === "number" && Number.isFinite(opts.retryExtraTokens) ? opts.retryExtraTokens : 0;
  const extraTokens = extraTokensRaw > 0 ? Math.trunc(extraTokensRaw) : 0;

  while (out.length < opts.maxAttempts) {
    const prev = out[out.length - 1] ?? 0;

    const nextByMultiplier = Math.ceil(prev * opts.multiplier);
    const nextByExtra = extraTokens > 0 ? prev + extraTokens : 0;

    const next = Math.min(opts.cap, Math.max(prev + 1, nextByMultiplier, nextByExtra));
    if (!Number.isFinite(next) || next <= prev) break;
    out.push(next);
  }

  return out;
}

