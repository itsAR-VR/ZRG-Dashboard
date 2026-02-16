import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("AI draft booking conversion analytics windowing", () => {
  it("anchors windowing to Message.sentAt and dedupes by lead", () => {
    const source = read("actions/ai-draft-response-analytics-actions.ts");

    assert.match(source, /getAiDraftBookingConversionStats/, "expected booking conversion server action export");
    assert.match(source, /draft_send_time/, "expected send-time anchor CTE");
    assert.match(source, /dst\."sentAt"\s*>=\s*\$\{from\}/, "expected windowing to filter on derived sentAt");
    assert.ok(
      !source.includes('d."updatedAt" >='),
      'expected booking conversion query to avoid using AIDraft.updatedAt for windows'
    );

    assert.match(source, /appointmentBookedAt/, "expected booking timestamp evidence to be referenced");
    assert.match(source, /maturityBufferDays/, "expected pending buffer semantics to be present");
    assert.match(source, /maturityCutoff/, "expected maturity cutoff to be precomputed to avoid SQL timestamp-interval inference");
    assert.ok(
      !source.includes("${to} - (${maturityBufferDays}"),
      "expected pending cutoff to avoid `${to} - (${maturityBufferDays} * interval ...)` inside SQL"
    );

    // Lead-level dedupe guard: this metric is per-lead, not per-draft.
    assert.match(
      source,
      /group by\s+l\.id,\s+d\.channel,\s+d\."responseDisposition"/,
      "expected lead bucket grouping"
    );
    assert.match(source, /count\(distinct lead_id\)/, "expected final aggregation to count distinct leads");
  });
});
