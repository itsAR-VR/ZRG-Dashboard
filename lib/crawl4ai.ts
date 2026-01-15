import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function stripHtmlToText(html: string): string {
  // Best-effort HTML -> plain text. This is intentionally simple; Crawl4AI is preferred when configured.
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim();
}

function extractHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const title = m[1].replace(/\s+/g, " ").trim();
  return title || null;
}

async function fetchTextWithLimit(url: string, maxBytes: number): Promise<{ text: string; contentType: string }> {
  const controller = new AbortController();
  const resp = await fetch(url, {
    signal: controller.signal,
    headers: {
      "User-Agent": "ZRG-Dashboard/1.0 (KnowledgeAssets)",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`fetch failed (${resp.status}): ${body.slice(0, 200)}`);
  }

  const contentType = resp.headers.get("content-type") || "";
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const text = await resp.text();
    return { text: text.slice(0, maxBytes), contentType };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.length;
    if (received > maxBytes) {
      controller.abort();
      break;
    }
    chunks.push(value);
  }

  const buf = Buffer.concat(chunks);
  return { text: buf.toString("utf8"), contentType };
}

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
  if (localEnabled) {
    try {
      const python = process.env.CRAWL4AI_PYTHON_BIN || "python3";
      const script = process.env.CRAWL4AI_SCRIPT_PATH || "scripts/crawl4ai/extract_markdown.py";
      const timeoutMs = Math.max(
        10_000,
        Number.parseInt(process.env.CRAWL4AI_TIMEOUT_MS || "120000", 10) || 120_000
      );

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
    } catch (e) {
      console.warn("[Crawl4AI] Local runner failed; falling back to simple fetch:", e);
    }
  }

  // Fallback: simple fetch and rough HTML -> text conversion.
  // This avoids hard failures when Crawl4AI is not configured (common in production).
  const maxBytes = Math.max(50_000, Number.parseInt(process.env.KNOWLEDGE_WEBSITE_FETCH_MAX_BYTES || "2000000", 10) || 2_000_000);
  const { text, contentType } = await fetchTextWithLimit(url, maxBytes);
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType) || text.trim().startsWith("<");
  const title = isHtml ? extractHtmlTitle(text) : null;
  const extracted = isHtml ? stripHtmlToText(text) : text.trim();

  const markdown = [
    `# ${title || url}`,
    "",
    `Source: ${url}`,
    "",
    extracted.length > 180_000 ? `${extracted.slice(0, 180_000)}\n\n[TRUNCATED]` : extracted,
  ].join("\n");

  return { markdown };
}
