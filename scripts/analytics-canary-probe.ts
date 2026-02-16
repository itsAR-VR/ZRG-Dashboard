#!/usr/bin/env tsx

// Ensure this file is treated as a module (prevents type name collisions across scripts in `tsc --noEmit`).
export {};

type ProbeMode = "cold" | "warm";

type ProbeSample = {
  mode: ProbeMode;
  endpoint: string;
  url: string;
  status: number;
  cache: string | null;
  durationMs: number | null;
  requestId: string | null;
  runIndex: number;
};

type EndpointSummary = {
  endpoint: string;
  samples: number;
  successRate: number;
  hitRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  statuses: Record<string, number>;
};

type ProbeConfig = {
  baseUrl: string;
  clientId: string;
  from: string;
  to: string;
  coldSamples: number;
  warmSamples: number;
  cookie?: string;
  outFile?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COLD_SAMPLES = 8;
const DEFAULT_WARM_SAMPLES = 8;

function parseArgs(argv: string[]): ProbeConfig {
  const out: Partial<ProbeConfig> = {
    baseUrl: "https://zrg-dashboard.vercel.app",
    coldSamples: DEFAULT_COLD_SAMPLES,
    warmSamples: DEFAULT_WARM_SAMPLES,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url") out.baseUrl = argv[++i];
    else if (arg === "--client-id") out.clientId = argv[++i];
    else if (arg === "--from") out.from = argv[++i];
    else if (arg === "--to") out.to = argv[++i];
    else if (arg === "--cold-samples") out.coldSamples = Number.parseInt(argv[++i] || "", 10);
    else if (arg === "--warm-samples") out.warmSamples = Number.parseInt(argv[++i] || "", 10);
    else if (arg === "--cookie") out.cookie = argv[++i];
    else if (arg === "--out") out.outFile = argv[++i];
  }

  if (!out.clientId) {
    throw new Error("Missing required --client-id <workspace-uuid>");
  }

  const now = new Date();
  const fallbackTo = now.toISOString();
  const fallbackFrom = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  return {
    baseUrl: String(out.baseUrl || "https://zrg-dashboard.vercel.app").replace(/\/$/, ""),
    clientId: out.clientId,
    from: out.from || fallbackFrom,
    to: out.to || fallbackTo,
    coldSamples: Number.isFinite(out.coldSamples) ? Math.max(1, out.coldSamples || DEFAULT_COLD_SAMPLES) : DEFAULT_COLD_SAMPLES,
    warmSamples: Number.isFinite(out.warmSamples) ? Math.max(1, out.warmSamples || DEFAULT_WARM_SAMPLES) : DEFAULT_WARM_SAMPLES,
    cookie: out.cookie || process.env.ANALYTICS_CANARY_COOKIE,
    outFile: out.outFile,
  };
}

function buildEndpoints(baseUrl: string, clientId: string, from: string, to: string): Array<{ endpoint: string; url: string }> {
  const qs = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({
      clientId,
      from,
      to,
      ...(extra || {}),
    });
    return params.toString();
  };

  return [
    { endpoint: "/api/analytics/overview(core)", url: `${baseUrl}/api/analytics/overview?${qs({ parts: "core" })}` },
    { endpoint: "/api/analytics/overview(breakdowns)", url: `${baseUrl}/api/analytics/overview?${qs({ parts: "breakdowns" })}` },
    { endpoint: "/api/analytics/workflows", url: `${baseUrl}/api/analytics/workflows?${qs()}` },
    { endpoint: "/api/analytics/campaigns", url: `${baseUrl}/api/analytics/campaigns?${qs()}` },
    { endpoint: "/api/analytics/response-timing", url: `${baseUrl}/api/analytics/response-timing?${qs()}` },
    { endpoint: "/api/analytics/crm/rows(summary)", url: `${baseUrl}/api/analytics/crm/rows?${qs({ mode: "summary" })}` },
  ];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? null;
}

function summarize(samples: ProbeSample[]): EndpointSummary[] {
  const grouped = new Map<string, ProbeSample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.endpoint) ?? [];
    list.push(sample);
    grouped.set(sample.endpoint, list);
  }

  return Array.from(grouped.entries()).map(([endpoint, rows]) => {
    const durations = rows
      .map((r) => r.durationMs)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const statusCounts: Record<string, number> = {};
    for (const row of rows) statusCounts[String(row.status)] = (statusCounts[String(row.status)] || 0) + 1;

    const ok = rows.filter((r) => r.status >= 200 && r.status < 300).length;
    const hits = rows.filter((r) => r.cache === "hit").length;

    return {
      endpoint,
      samples: rows.length,
      successRate: rows.length > 0 ? ok / rows.length : 0,
      hitRate: rows.length > 0 ? hits / rows.length : 0,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      statuses: statusCounts,
    };
  });
}

async function probeOne(mode: ProbeMode, runIndex: number, endpoint: string, url: string, cookie?: string): Promise<ProbeSample> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  const durationHeader = response.headers.get("x-zrg-duration-ms");
  const durationParsed = durationHeader ? Number(durationHeader) : Number.NaN;

  return {
    mode,
    endpoint,
    url,
    status: response.status,
    cache: response.headers.get("x-zrg-cache"),
    durationMs: Number.isFinite(durationParsed) ? durationParsed : null,
    requestId: response.headers.get("x-request-id"),
    runIndex,
  };
}

function shiftWindow(fromIso: string, toIso: string, offsetMinutes: number): { from: string; to: string } {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const delta = offsetMinutes * 60 * 1000;
  return {
    from: new Date(from.getTime() + delta).toISOString(),
    to: new Date(to.getTime() + delta).toISOString(),
  };
}

async function runMode(mode: ProbeMode, cfg: ProbeConfig): Promise<ProbeSample[]> {
  const samples = mode === "cold" ? cfg.coldSamples : cfg.warmSamples;
  const out: ProbeSample[] = [];

  for (let i = 0; i < samples; i++) {
    const offsetMinutes = mode === "cold" ? i + 1 : 0;
    const window = shiftWindow(cfg.from, cfg.to, offsetMinutes);
    const endpoints = buildEndpoints(cfg.baseUrl, cfg.clientId, window.from, window.to);

    for (const item of endpoints) {
      out.push(await probeOne(mode, i + 1, item.endpoint, item.url, cfg.cookie));
    }
  }

  return out;
}

async function main() {
  const cfg = parseArgs(process.argv);
  const startedAt = new Date().toISOString();

  const cold = await runMode("cold", cfg);
  const warm = await runMode("warm", cfg);

  const result = {
    generatedAt: new Date().toISOString(),
    startedAt,
    config: {
      baseUrl: cfg.baseUrl,
      clientId: cfg.clientId,
      from: cfg.from,
      to: cfg.to,
      coldSamples: cfg.coldSamples,
      warmSamples: cfg.warmSamples,
      usedCookie: Boolean(cfg.cookie),
    },
    cold: {
      summary: summarize(cold),
      samples: cold,
    },
    warm: {
      summary: summarize(warm),
      samples: warm,
    },
  };

  const json = JSON.stringify(result, null, 2);
  if (cfg.outFile) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(cfg.outFile, json, "utf8");
    // Keep stdout small when writing files.
    console.log(`Wrote analytics probe report to ${cfg.outFile}`);
    return;
  }

  console.log(json);
}

main().catch((error) => {
  console.error("[analytics-canary-probe] failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
