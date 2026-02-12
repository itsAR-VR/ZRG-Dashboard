import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDisqualificationMessage,
  extractQualificationAnswersFromGhlCustomFields,
} from "../booking-qualification";
import { buildBookingQualificationDedupeKey } from "../booking-qualification-jobs/enqueue";

describe("booking qualification helpers", () => {
  it("builds deterministic dedupe keys", () => {
    const key = buildBookingQualificationDedupeKey({
      clientId: "client-1",
      leadId: "lead-1",
      provider: "CALENDLY",
      anchorId: "anchor-1",
    });
    assert.equal(key, "client-1:lead-1:CALENDLY:anchor-1");
  });

  it("substitutes disqualification template variables", () => {
    const text = buildDisqualificationMessage({
      template: "Hi, {companyName}. Reasons:\n{reasons}",
      companyName: "Acme",
      reasons: ["Not in target market", "Missing decision authority"],
    });

    assert.ok(text.includes("Acme"));
    assert.ok(text.includes("- Not in target market"));
    assert.ok(text.includes("- Missing decision authority"));
  });

  it("extracts question answers from GHL custom fields using normalized question names", () => {
    const answers = extractQualificationAnswersFromGhlCustomFields({
      questions: [
        { id: "q1", question: "Company Size", required: true },
        { id: "q2", question: "Decision Maker", required: true },
      ],
      customFields: [
        { name: "company size", value: "120" },
        { key: "Decision Maker", value: "Yes" },
        { name: "company size", value: "duplicate" },
      ],
    });

    assert.equal(answers.length, 2);
    assert.deepEqual(answers[0], {
      question: "Company Size",
      answer: "120",
      position: 0,
    });
    assert.deepEqual(answers[1], {
      question: "Decision Maker",
      answer: "Yes",
      position: 1,
    });
  });
});
