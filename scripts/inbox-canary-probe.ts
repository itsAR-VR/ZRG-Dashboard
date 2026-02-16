#!/usr/bin/env tsx

// Ensure this file is treated as a module (prevents type name collisions across scripts in `tsc --noEmit`).
export {};

type ProbeSample = {
  endpoint: string;
  url: string;
  status: number;
  durationMs: number | null;
  requestId: string | null;
  readApiEnabled: string | null;
  readApiReason: string | null;
  runIndex: number;
};

type EndpointSummary = {
  endpoint: string;
  samples: number;
  successRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  statuses: Record<string, number>;
};

type ProbeConfig = {
  baseUrl: string;
  clientId?: string;
  search?: string;
  samples: number;
  cookie?: string;
  outFile?: string;
};

const DEFAULT_SAMPLES = 10;

function parseArgs(argv: string[]): ProbeConfig {
  const out: Partial<ProbeConfig> = { baseUrl: "https://zrg-dashboard.vercel.app", samples: DEFAULT_SAMPLES };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url") out.baseUrl = argv[++i];
    else if (arg === "--client-id") out.clientId = argv[++i];
    else if (arg === "--search") out.search = argv[++i];
    else if (arg === "--samples") out.samples = Number.parseInt(argv[++i] || "", 10);
    else if (arg === "--cookie") out.cookie = argv[++i];
    else if (arg === "--out") out.outFile = argv[++i];
  }

  return {
    baseUrl: String(out.baseUrl || "https://zrg-dashboard.vercel.app").replace(/\/$/, ""),
    clientId: typeof out.clientId === "string" && out.clientId.trim() ? out.clientId.trim() : undefined,
    search: typeof out.search === "string" && out.search.trim() ? out.search.trim() : undefined,
    samples: Number.isFinite(out.samples) ? Math.max(1, out.samples || DEFAULT_SAMPLES) : DEFAULT_SAMPLES,
    cookie: out.cookie || process.env.INBOX_CANARY_COOKIE || process.env.ANALYTICS_CANARY_COOKIE,
    outFile: out.outFile,
  };
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
    return {
      endpoint,
      samples: rows.length,
      successRate: rows.length > 0 ? ok / rows.length : 0,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      statuses: statusCounts,
    };
  });
}

function buildEndpoints(cfg: ProbeConfig): Array<{ endpoint: string; url: string }> {
  const qs = (extra?: Record<string, string>) => {
    const params = new URLSearchParams();
    if (cfg.clientId) params.set("clientId", cfg.clientId);
    for (const [key, value] of Object.entries(extra || {})) params.set(key, value);
    return params.toString();
  };

  const base = cfg.baseUrl.replace(/\/$/, "");

  return [
    { endpoint: "/api/inbox/counts", url: `${base}/api/inbox/counts${cfg.clientId ? `?${qs()}` : ""}` },
    {
      endpoint: "/api/inbox/conversations",
      url: `${base}/api/inbox/conversations?${qs({
        limit: "50",
        ...(cfg.search ? { search: cfg.search } : {}),
      })}`,
    },
  ];
}

async function probeOne(runIndex: number, endpoint: string, url: string, cookie?: string): Promise<ProbeSample> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(url, { method: "GET", headers, cache: "no-store" });
  const durationHeader = response.headers.get("x-zrg-duration-ms");
  const durationParsed = durationHeader ? Number(durationHeader) : Number.NaN;

  return {
    endpoint,
    url,
    status: response.status,
    durationMs: Number.isFinite(durationParsed) ? durationParsed : null,
    requestId: response.headers.get("x-request-id"),
    readApiEnabled: response.headers.get("x-zrg-read-api-enabled"),
    readApiReason: response.headers.get("x-zrg-read-api-reason"),
    runIndex,
  };
}

async function main() {
  const cfg = parseArgs(process.argv);
  const endpoints = buildEndpoints(cfg);
  const startedAt = new Date().toISOString();

  const samples: ProbeSample[] = [];
  for (let i = 0; i < cfg.samples; i += 1) {
    for (const item of endpoints) {
      samples.push(await probeOne(i + 1, item.endpoint, item.url, cfg.cookie));
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    startedAt,
    config: {
      baseUrl: cfg.baseUrl,
      clientId: cfg.clientId ?? null,
      search: cfg.search ?? null,
      samples: cfg.samples,
      usedCookie: Boolean(cfg.cookie),
    },
    summary: summarize(samples),
    samples,
  };

  const json = JSON.stringify(result, null, 2);
  if (cfg.outFile) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(cfg.outFile, json, "utf8");
    console.log(`Wrote inbox probe report to ${cfg.outFile}`);
    return;
  }

  console.log(json);
}

main().catch((error) => {
  console.error("[inbox-canary-probe] failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
