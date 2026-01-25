import "server-only";

function getResendTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.RESEND_TIMEOUT_MS || "10000", 10);
  if (!Number.isFinite(parsed)) return 10_000;
  return Math.max(1_000, Math.min(60_000, parsed));
}

function getResendApiKey(value?: string | null): string | null {
  const key = (value ?? process.env.RESEND_API_KEY ?? "").trim();
  return key ? key : null;
}

function getResendFromEmail(value?: string | null): string | null {
  const from = (value ?? process.env.RESEND_FROM_EMAIL ?? "").trim();
  return from ? from : null;
}

export async function sendResendEmail(opts: {
  apiKey?: string | null;
  fromEmail?: string | null;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = getResendApiKey(opts.apiKey);
  if (!apiKey) return { success: false, error: "RESEND_API_KEY not configured" };

  const from = getResendFromEmail(opts.fromEmail);
  if (!from) return { success: false, error: "RESEND_FROM_EMAIL not configured" };

  const to = opts.to.map((v) => v.trim()).filter(Boolean);
  if (to.length === 0) return { success: false, error: "Missing recipient email(s)" };

  const subject = (opts.subject || "").trim();
  if (!subject) return { success: false, error: "Missing subject" };

  const text = (opts.text || "").trim();
  if (!text) return { success: false, error: "Missing text" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getResendTimeoutMs());

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        ...(opts.html ? { html: opts.html } : {}),
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return { success: false, error: `Resend request failed (${response.status}): ${bodyText.slice(0, 500)}` };
    }

    return { success: true };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return { success: false, error: isAbort ? "Resend request timed out" : (error instanceof Error ? error.message : "Resend request failed") };
  } finally {
    clearTimeout(timeout);
  }
}
