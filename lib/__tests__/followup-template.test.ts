import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractFollowUpTemplateTokens,
  getUnknownFollowUpTemplateTokens,
  renderFollowUpTemplateStrict,
  type FollowUpTemplateValues,
} from "../followup-template";
import { fnv1a32 } from "../spintax";

const BASE_VALUES: FollowUpTemplateValues = {
  firstName: "Ava",
  lastName: "Ng",
  email: "ava@example.com",
  phone: "+14155552671",
  leadCompanyName: "Acme Inc",
  aiPersonaName: "Jordan",
  companyName: "ZRG",
  targetResult: "book more meetings",
  qualificationQuestion1: "What is your current role?",
  qualificationQuestion2: "What is your budget?",
  bookingLink: "https://example.com/book",
  availability: "Mon 3pm or Tue 11am",
  timeOption1: "Mon 3pm",
  timeOption2: "Tue 11am",
};

describe("followup-template", () => {
  it("extracts tokens (single and double braces)", () => {
    assert.deepEqual(extractFollowUpTemplateTokens("Hi {firstName} {{contact.first_name}}"), [
      "{firstName}",
      "{{contact.first_name}}",
    ]);
  });

  it("detects unknown tokens", () => {
    assert.deepEqual(getUnknownFollowUpTemplateTokens("Hi {firstName} {unknown}"), ["{unknown}"]);
  });

  it("renders firstName aliases", () => {
    const aliases = ["{firstName}", "{FIRST_NAME}", "{FIRST\\_NAME}", "{{contact.first_name}}", "{{contact.first\\_name}}"];
    for (const token of aliases) {
      const res = renderFollowUpTemplateStrict({ template: `Hi ${token}`, values: BASE_VALUES });
      assert.equal(res.ok, true);
      if (res.ok) assert.equal(res.output, "Hi Ava");
    }
  });

  it("renders basic lead variables", () => {
    const res = renderFollowUpTemplateStrict({
      template: "{lastName} {email} {phone}",
      values: BASE_VALUES,
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.output, "Ng ava@example.com +14155552671");
  });

  it("renders workspace and lead-company variables", () => {
    const res = renderFollowUpTemplateStrict({
      template: "{senderName} / {name} / {companyName} / {company} / {leadCompanyName} / {result} / {achieving result}",
      values: BASE_VALUES,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.output, "Jordan / Jordan / ZRG / ZRG / Acme Inc / book more meetings / book more meetings");
    }
  });

  it("renders booking/availability variables", () => {
    const res = renderFollowUpTemplateStrict({
      template: "{calendarLink} {link} {availability} {time 1 day 1} {x day x time} {time 2 day 2} {y day y time}",
      values: BASE_VALUES,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(
        res.output,
        "https://example.com/book https://example.com/book Mon 3pm or Tue 11am Mon 3pm Mon 3pm Tue 11am Tue 11am"
      );
    }
  });

  it("renders qualification question variables and aliases", () => {
    const res = renderFollowUpTemplateStrict({
      template:
        "{qualificationQuestion1} {qualification question 1} | {qualificationQuestion2} {qualification question 2}",
      values: BASE_VALUES,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(
        res.output,
        "What is your current role? What is your current role? | What is your budget? What is your budget?"
      );
    }
  });

  it("blocks rendering when a referenced variable is missing", () => {
    const res = renderFollowUpTemplateStrict({
      template: "Hi {firstName}",
      values: { ...BASE_VALUES, firstName: null },
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.errors.some((e) => e.type === "missing_value" && e.token === "{firstName}"), true);
    }
  });

  it("returns the template unchanged when no tokens are present", () => {
    const res = renderFollowUpTemplateStrict({
      template: "Hello there.",
      values: {},
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.output, "Hello there.");
  });

  it("accumulates unknown-token and missing-value errors", () => {
    const res = renderFollowUpTemplateStrict({
      template: "{firstName} {unknown} {companyName}",
      values: { ...BASE_VALUES, companyName: null },
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      const types = res.errors.map((e) => e.type).sort();
      assert.deepEqual(types, ["missing_value", "unknown_token"]);
    }
  });

  it("expands spintax deterministically per seed", () => {
    const template = "[[Hi|Hey|Hello]] {firstName}";
    const seed = "lead-123:step-1";
    const res1 = renderFollowUpTemplateStrict({ template, values: BASE_VALUES, spintaxSeed: seed });
    const res2 = renderFollowUpTemplateStrict({ template, values: BASE_VALUES, spintaxSeed: seed });
    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    if (res1.ok && res2.ok) {
      assert.equal(res1.output, res2.output);
    }
  });

  it("expands spintax with distributed variants across seeds", () => {
    const template = "[[Hi|Hey|Hello]] {firstName}";
    const options = ["Hi", "Hey", "Hello"];
    const seedA = "lead-a:step-1";
    const indexA = fnv1a32(`${seedA}:0`) % options.length;
    let seedB = "";
    let indexB = indexA;
    for (let i = 0; i < 50; i += 1) {
      const candidate = `lead-${i}:step-1`;
      const candidateIndex = fnv1a32(`${candidate}:0`) % options.length;
      if (candidateIndex !== indexA) {
        seedB = candidate;
        indexB = candidateIndex;
        break;
      }
    }
    assert.notEqual(indexA, indexB, "expected to find a seed with a different variant");

    const resA = renderFollowUpTemplateStrict({ template, values: BASE_VALUES, spintaxSeed: seedA });
    const resB = renderFollowUpTemplateStrict({ template, values: BASE_VALUES, spintaxSeed: seedB });
    assert.equal(resA.ok, true);
    assert.equal(resB.ok, true);
    if (resA.ok && resB.ok) {
      assert.equal(resA.output, `${options[indexA]} Ava`);
      assert.equal(resB.output, `${options[indexB]} Ava`);
    }
  });

  it("renders template variables inside spintax options", () => {
    const res = renderFollowUpTemplateStrict({
      template: "[[Hi {firstName}|Hey {firstName}]]",
      values: BASE_VALUES,
      spintaxSeed: "lead-xyz:step-2",
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.output.includes("Ava"), true);
    }
  });

  it("blocks malformed spintax patterns", () => {
    const unclosed = renderFollowUpTemplateStrict({
      template: "[[Hi|Hey",
      values: BASE_VALUES,
      spintaxSeed: "lead-1:step-1",
    });
    assert.equal(unclosed.ok, false);
    if (!unclosed.ok) {
      assert.equal(unclosed.errors.some((e) => e.type === "spintax_error"), true);
    }

    const emptyOption = renderFollowUpTemplateStrict({
      template: "[[Hi||Hey]]",
      values: BASE_VALUES,
      spintaxSeed: "lead-1:step-1",
    });
    assert.equal(emptyOption.ok, false);
    if (!emptyOption.ok) {
      assert.equal(emptyOption.errors.some((e) => e.type === "spintax_error"), true);
    }

    const nested = renderFollowUpTemplateStrict({
      template: "[[Hi [[there|you]]|Hey]]",
      values: BASE_VALUES,
      spintaxSeed: "lead-1:step-1",
    });
    assert.equal(nested.ok, false);
    if (!nested.ok) {
      assert.equal(nested.errors.some((e) => e.type === "spintax_error"), true);
    }
  });
});
