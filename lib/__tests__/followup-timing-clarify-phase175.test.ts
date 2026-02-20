import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("phase 175 timing clarify hardening", () => {
  it("uses 7-day re-engagement enrollment delay after clarify attempt #2", () => {
    const source = read("actions/message-actions.ts");
    assert.match(
      source,
      /const ENROLL_DELAY_DAYS = 7;/,
      "expected attempt-2 exhaustion to keep a 7-day re-engagement delay"
    );
  });

  it("uses hybrid attempt-2 copy generation (sms deterministic; email/linkedin AI + fallback)", () => {
    const source = read("actions/message-actions.ts");
    assert.match(
      source,
      /task\.type === "email" \|\| task\.type === "linkedin"[\s\S]*generateTimingClarifyNudge/,
      "expected AI nudge generation for email/linkedin"
    );
    assert.match(
      source,
      /const attempt2Message = \(aiNudge\?\.message \|\| deterministicAttempt2Message\)\.trim\(\);/,
      "expected deterministic fallback for attempt-2 message"
    );
  });

  it("wires cancel attempt #2 helper into all inbound post-process paths", () => {
    const emailPipeline = read("lib/inbound-post-process/pipeline.ts");
    const emailBackground = read("lib/background-jobs/email-inbound-post-process.ts");
    const smsBackground = read("lib/background-jobs/sms-inbound-post-process.ts");
    const linkedinBackground = read("lib/background-jobs/linkedin-inbound-post-process.ts");

    assert.match(emailPipeline, /cancelPendingTimingClarifyAttempt2OnInbound\(\{ leadId: lead\.id \}\)/);
    assert.match(emailBackground, /cancelPendingTimingClarifyAttempt2OnInbound\(\{ leadId: lead\.id \}\)/);
    assert.match(smsBackground, /cancelPendingTimingClarifyAttempt2OnInbound\(\{ leadId: lead\.id \}\)/);
    assert.match(linkedinBackground, /cancelPendingTimingClarifyAttempt2OnInbound\(\{ leadId: lead\.id \}\)/);
  });

  it("routes Not Interested soft deferrals through the timing reengage gate", () => {
    const emailPipeline = read("lib/inbound-post-process/pipeline.ts");
    assert.match(
      emailPipeline,
      /sentimentTag === "Not Interested"[\s\S]*runFollowUpTimingReengageGate[\s\S]*gate\.decision === "deferral"/
    );
    assert.match(
      emailPipeline,
      /scheduleFollowUpTimingFromInbound\([\s\S]*sentimentTag: "Follow Up"/,
      "expected scheduler call to run with Follow Up sentiment contract"
    );
  });

  it("hardens no-date clarify task upsert and avoids clarify-path snooze writes", () => {
    const source = read("lib/followup-timing.ts");
    assert.match(
      source,
      /if \(existingClarifyTask\) \{[\s\S]*prisma\.followUpTask\.updateMany\(/,
      "expected clarify #1 update path to use updateMany"
    );
    assert.match(source, /if \(!taskId\) \{[\s\S]*prisma\.followUpTask\.create\(/);

    const noDateBranch = source.match(
      /if \(!extracted\.success \|\| !extracted\.data\.hasConcreteDate \|\| !extractionDate\) \{[\s\S]*?return \{[\s\S]*?reason: `clarify_missing_date:\$\{reason\}`,[\s\S]*?\};[\s\S]*?\}/
    );
    assert.ok(noDateBranch, "expected explicit no-date clarify branch");
    assert.ok(
      !noDateBranch[0].includes("pauseFollowUpsUntil(") && !noDateBranch[0].includes("snoozedUntil"),
      "no-date clarify path should not pause/snooze follow-ups"
    );
  });

  it("defines followup timing reengage gate prompt key contract", () => {
    const source = read("lib/followup-timing.ts");
    assert.match(source, /promptKey: "followup\.timing_reengage_gate\.v1"/);
    assert.match(source, /decision: "deferral" \| "hard_no" \| "unclear"/);
  });
});

