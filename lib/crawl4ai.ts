import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function crawl4aiExtractMarkdown(url: string): Promise<{ markdown: string }> {
  const serviceUrl = process.env.CRAWL4AI_SERVICE_URL?.trim();
  if (serviceUrl) {
    const resp = await fetch(`${serviceUrl.replace(/\/$/, "")}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CRAWL4AI_SERVICE_SECRET
          ? { Authorization: `Bearer ${process.env.CRAWL4AI_SERVICE_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ url }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`crawl4ai service failed (${resp.status}): ${text.slice(0, 200)}`);
    }

    const body = (await resp.json()) as any;
    const markdown = typeof body?.markdown === "string" ? body.markdown : "";
    return { markdown };
  }

  // Local runner (dev): calls the python script in `scripts/crawl4ai/`.
  const localEnabled = process.env.CRAWL4AI_LOCAL_RUNNER === "true";
  if (!localEnabled) {
    throw new Error(
      "Crawl4AI not configured. Set CRAWL4AI_SERVICE_URL (recommended) or enable CRAWL4AI_LOCAL_RUNNER=true and install crawl4ai."
    );
  }

  const python = process.env.CRAWL4AI_PYTHON_BIN || "python3";
  const script = process.env.CRAWL4AI_SCRIPT_PATH || "scripts/crawl4ai/extract_markdown.py";
  const timeoutMs = Math.max(10_000, Number.parseInt(process.env.CRAWL4AI_TIMEOUT_MS || "120000", 10) || 120_000);

  const { stdout } = await execFileAsync(python, [script, url], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10MB
  });

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("crawl4ai runner returned invalid JSON");
  }

  if (!parsed?.success) {
    throw new Error(parsed?.error || "crawl4ai runner failed");
  }

  const markdown = typeof parsed?.markdown === "string" ? parsed.markdown : "";
  return { markdown };
}

