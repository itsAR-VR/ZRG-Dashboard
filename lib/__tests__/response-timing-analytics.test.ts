import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Response timing analytics (Phase 132)", () => {
  it("anchors windowing to ResponseTimingEvent.inboundSentAt", () => {
    const source = read("actions/response-timing-analytics-actions.ts");
    assert.match(source, /rte\."inboundSentAt" >=/);
    assert.match(source, /rte\."inboundSentAt" < \(\$\{to\}::timestamp\)/);
  });

  it("excludes canceled bookings and uses appointmentCanceledAt", () => {
    const source = read("actions/response-timing-analytics-actions.ts");
    assert.ok(source.includes('"appointmentCanceledAt" is null'));
    assert.ok(source.includes('"appointmentStatus" is null or l."appointmentStatus" != \'canceled\''));
  });

  it("attributes booking conversion to the first responder", () => {
    const source = read("actions/response-timing-analytics-actions.ts");
    // Ties go to setters (<=).
    assert.ok(source.includes('rte."setterResponseSentAt" <= rte."aiResponseSentAt"'));
    assert.match(source, /then 'SETTER'/);
    assert.match(source, /then 'AI'/);
  });

  it("defaults maturity buffer to 14 days", () => {
    const source = read("actions/response-timing-analytics-actions.ts");
    assert.ok(source.includes("maturityBufferDays"));
    assert.ok(source.includes("maturityBufferDays, 14"));
  });
});
