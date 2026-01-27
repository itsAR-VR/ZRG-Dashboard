import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type LogEntry = {
  level?: string | null;
  message?: string | null;
  function?: string | null;
  requestPath?: string | null;
  TimeUTC?: string | null;
};

type Signature = {
  id: string;
  pattern: RegExp;
};

const SIGNATURES: Signature[] = [
  { id: "supabase_refresh_token_not_found", pattern: /refresh_token_not_found|Refresh Token Not Found/i },
  { id: "prisma_driver_adapter_bind_message", pattern: /DriverAdapterError: bind message has \d+ parameter formats/i },
  { id: "max_call_stack", pattern: /RangeError: Maximum call stack size exceeded/i },
  { id: "ghl_invalid_country_calling_code", pattern: /Invalid country calling code/i },
  { id: "ghl_missing_phone_number", pattern: /Missing phone number/i },
  { id: "ghl_sms_dnd", pattern: /dnd is active.*sms|Cannot send message as DND is active for SMS/i },
  { id: "ai_max_output_tokens", pattern: /Post-process error: hit max_output_tokens/i },
  { id: "appointment_upsert_missing_ghl_id", pattern: /Missing ghlAppointmentId for GHL appointment upsert/i },
];

function main(): void {
  const argPath = process.argv[2] || "logs_result copy.json";
  const filePath = resolve(process.cwd(), argPath);

  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    console.error(`[logs:check] Expected a JSON array in ${argPath}`);
    process.exit(2);
  }

  const entries: LogEntry[] = parsed;
  const errorEntries = entries.filter((e) => (e.level || "").toLowerCase() === "error");

  const hits = new Map<string, { count: number; sample?: LogEntry }>();
  for (const signature of SIGNATURES) {
    hits.set(signature.id, { count: 0 });
  }

  for (const entry of errorEntries) {
    const message = entry.message || "";
    for (const signature of SIGNATURES) {
      if (signature.pattern.test(message)) {
        const current = hits.get(signature.id)!;
        current.count += 1;
        if (!current.sample) current.sample = entry;
      }
    }
  }

  const failing = Array.from(hits.entries())
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count);

  if (failing.length === 0) {
    console.log(`[logs:check] OK — scanned ${entries.length} entries (${errorEntries.length} error-level) in ${argPath}`);
    return;
  }

  console.error(`[logs:check] Found ${failing.length} known error signatures in ${argPath}:`);
  for (const [id, info] of failing) {
    const sample = info.sample;
    const sampleLine = sample
      ? ` sample: ${sample.TimeUTC || "unknown-time"} ${sample.function || sample.requestPath || ""} — ${(sample.message || "").split("\n")[0]}`
      : "";
    console.error(`- ${id}: ${info.count}${sampleLine}`);
  }

  process.exit(1);
}

main();

