#!/usr/bin/env tsx

export {};

type Sample = {
  endpoint: string;
  band: string;
  runIndex: number;
  status: number;
  durationMs: number;
  requestId: string | null;
  timedOut: boolean;
  error: string | null;
};

type EndpointSummary = {
  endpoint: string;
  samples: number;
  successRate: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  statuses: Record<string, number>;
};

type BandSummary = {
  name: string;
  concurrency: number;
  requestsPerWorker: number;
  summary: EndpointSummary[];
  samples: Sample[];
};

type Endpoint = {
  endpoint: string;
  url: string;
};

type BandConfig = {
  name: string;
  concurrency: number;
  requestsPerWorker: number;
};

type Config = {
  baseUrl: string;
  clientId?: string;
  cookie?: string;
  search?: string;
  includeAnalytics: boolean;
  includeInbox: boolean;
  timeoutMs: number;
  bands: BandConfig[];
  outFile?: string;
};

const DEFAULT_BANDS = "small:2:4,medium:6:4,large:12:4";

function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBands(raw: string): BandConfig[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [nameRaw, concurrencyRaw, requestsRaw] = part.split(":");
      const name = (nameRaw || "").trim();
      const concurrency = parseIntSafe(concurrencyRaw, 1);
      const requestsPerWorker = parseIntSafe(requestsRaw, 1);
      if (!name) {
        throw new Error(`Invalid band definition: "${part}"`);
      }
      return { name, concurrency, requestsPerWorker };
    });
}

function parseArgs(argv: string[]): Config {
  const out: Partial<Config> = {
    baseUrl: process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000",
    includeAnalytics: true,
    includeInbox: true,
    timeoutMs: 15_000,
    bands: parseBands(DEFAULT_BANDS),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") out.baseUrl = argv[++i];
    else if (arg === "--client-id") out.clientId = argv[++i];
    else if (arg === "--cookie") out.cookie = argv[++i];
    else if (arg === "--search") out.search = argv[++i];
    else if (arg === "--timeout-ms") out.timeoutMs = parseIntSafe(argv[++i], 15_000);
    else if (arg === "--bands") out.bands = parseBands(argv[++i] || DEFAULT_BANDS);
    else if (arg === "--no-analytics") out.includeAnalytics = false;
    else if (arg === "--no-inbox") out.includeInbox = false;
    else if (arg === "--out") out.outFile = argv[++i];
  }

  const includeAnalytics = out.includeAnalytics !== false;
  const includeInbox = out.includeInbox !== false;

  if (!includeAnalytics && !includeInbox) {
    throw new Error("At least one section must be enabled (analytics or inbox).");
  }

  if (includeAnalytics && !out.clientId) {
    throw new Error("Missing required --client-id when analytics endpoints are enabled.");
  }

  return {
    baseUrl: String(out.baseUrl || "http://127.0.0.1:3000").replace(/\/$/, ""),
    clientId: out.clientId,
    cookie:
      out.cookie ||
      process.env.ANALYTICS_CANARY_COOKIE ||
      process.env.INBOX_CANARY_COOKIE,
    search: out.search,
    includeAnalytics,
    includeInbox,
    timeoutMs: out.timeoutMs || 15_000,
    bands: out.bands || parseBands(DEFAULT_BANDS),
    outFile: out.outFile,
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? null;
}

function summarizeSamples(endpoint: string, rows: Sample[]): EndpointSummary {
  const durations = rows.map((row) => row.durationMs).filter((n) => Number.isFinite(n));
  const statuses: Record<string, number> = {};
  for (const row of rows) {
    statuses[String(row.status)] = (statuses[String(row.status)] || 0) + 1;
  }
  const successCount = rows.filter((row) => row.status >= 200 && row.status < 300).length;
  const samples = rows.length;
  return {
    endpoint,
    samples,
    successRate: samples > 0 ? successCount / samples : 0,
    errorRate: samples > 0 ? (samples - successCount) / samples : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations.length ? Math.max(...durations) : null,
    statuses,
  };
}

function buildEndpoints(cfg: Config): Endpoint[] {
  const params = (base: Record<string, string>) => new URLSearchParams(base).toString();
  const out: Endpoint[] = [];

  if (cfg.includeAnalytics && cfg.clientId) {
    const defaultAnalyticsParams = {
      clientId: cfg.clientId,
    };
    out.push({
      endpoint: "/api/analytics/overview(core)",
      url: `${cfg.baseUrl}/api/analytics/overview?${params({
        ...defaultAnalyticsParams,
        parts: "core",
      })}`,
    });
    out.push({
      endpoint: "/api/analytics/campaigns",
      url: `${cfg.baseUrl}/api/analytics/campaigns?${params(defaultAnalyticsParams)}`,
    });
    out.push({
      endpoint: "/api/analytics/response-timing",
      url: `${cfg.baseUrl}/api/analytics/response-timing?${params(defaultAnalyticsParams)}`,
    });
    out.push({
      endpoint: "/api/analytics/crm/rows(summary)",
      url: `${cfg.baseUrl}/api/analytics/crm/rows?${params({
        ...defaultAnalyticsParams,
        mode: "summary",
      })}`,
    });
  }

  if (cfg.includeInbox) {
    const inboxBase: Record<string, string> = cfg.clientId ? { clientId: cfg.clientId } : {};
    out.push({
      endpoint: "/api/inbox/counts",
      url: `${cfg.baseUrl}/api/inbox/counts${cfg.clientId ? `?${params(inboxBase)}` : ""}`,
    });
    out.push({
      endpoint: "/api/inbox/conversations",
      url: `${cfg.baseUrl}/api/inbox/conversations?${params({
        ...inboxBase,
        limit: "50",
        ...(cfg.search ? { search: cfg.search } : {}),
      })}`,
    });
  }

  return out;
}

async function probeOne(
  endpoint: Endpoint,
  runIndex: number,
  band: string,
  timeoutMs: number,
  cookie?: string
): Promise<Sample> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint.url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const durationHeader = response.headers.get("x-zrg-duration-ms");
    const parsed = durationHeader ? Number(durationHeader) : Number.NaN;
    const durationMs = Number.isFinite(parsed) ? parsed : Date.now() - startedAt;

    return {
      endpoint: endpoint.endpoint,
      band,
      runIndex,
      status: response.status,
      durationMs,
      requestId: response.headers.get("x-request-id"),
      timedOut: false,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = message.includes("timeout") || message.includes("aborted");
    return {
      endpoint: endpoint.endpoint,
      band,
      runIndex,
      status: 0,
      durationMs: Date.now() - startedAt,
      requestId: null,
      timedOut,
      error: message,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function runBand(cfg: Config, band: BandConfig, endpoints: Endpoint[]): Promise<BandSummary> {
  const samples: Sample[] = [];
  let runIndex = 0;

  for (let round = 0; round < band.requestsPerWorker; round += 1) {
    for (const endpoint of endpoints) {
      const batch = Array.from({ length: band.concurrency }, () => {
        runIndex += 1;
        return probeOne(endpoint, runIndex, band.name, cfg.timeoutMs, cfg.cookie);
      });
      const rows = await Promise.all(batch);
      samples.push(...rows);
    }
  }

  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.endpoint) ?? [];
    list.push(sample);
    grouped.set(sample.endpoint, list);
  }

  const summary = Array.from(grouped.entries()).map(([endpoint, rows]) =>
    summarizeSamples(endpoint, rows)
  );

  return {
    name: band.name,
    concurrency: band.concurrency,
    requestsPerWorker: band.requestsPerWorker,
    summary,
    samples,
  };
}

async function main() {
  const cfg = parseArgs(process.argv);
  const endpoints = buildEndpoints(cfg);
  const startedAt = new Date().toISOString();

  const bands: BandSummary[] = [];
  for (const band of cfg.bands) {
    bands.push(await runBand(cfg, band, endpoints));
  }

  const result = {
    generatedAt: new Date().toISOString(),
    startedAt,
    config: {
      baseUrl: cfg.baseUrl,
      clientId: cfg.clientId ?? null,
      search: cfg.search ?? null,
      includeAnalytics: cfg.includeAnalytics,
      includeInbox: cfg.includeInbox,
      timeoutMs: cfg.timeoutMs,
      usedCookie: Boolean(cfg.cookie),
      bands: cfg.bands,
    },
    endpoints,
    bands,
  };

  const json = JSON.stringify(result, null, 2);
  if (cfg.outFile) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(cfg.outFile, json, "utf8");
    console.log(`Wrote staged load report to ${cfg.outFile}`);
    return;
  }

  console.log(json);
}

main().catch((error) => {
  console.error(
    "[staged-read-load-check] failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
