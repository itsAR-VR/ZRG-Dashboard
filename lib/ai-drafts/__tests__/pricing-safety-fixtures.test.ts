import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { detectPricingHallucinations, enforcePricingAmountSafety } from "../../ai-drafts";

type PricingFixture = {
  id: string;
  description?: string;
  input: {
    draft: string;
    serviceDescription?: string | null;
    knowledgeContext?: string | null;
  };
  expected: {
    removedAmounts?: number[];
    removedCadenceAmounts?: number[];
    normalizedCadencePhrase?: boolean;
    addedClarifier?: boolean;
    draftIncludes?: string[];
    draftExcludes?: string[];
    detection?: {
      hallucinated?: number[];
      valid?: number[];
      cadenceMismatched?: number[];
      allDraft?: number[];
    };
  };
};

const FIXTURE_DIR = path.join(process.cwd(), "lib/ai-drafts/__fixtures__/pricing-safety");

function toSortedNumeric(values: number[] | undefined): number[] {
  return [...(values || [])].sort((a, b) => a - b);
}

function loadFixtures(): Array<{ file: string; fixture: PricingFixture }> {
  const files = readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();

  return files.map((file) => {
    const fullPath = path.join(FIXTURE_DIR, file);
    const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as PricingFixture;
    if (!parsed?.id || !parsed?.input || !parsed?.expected) {
      throw new Error(`Invalid fixture shape: ${file}`);
    }
    return { file, fixture: parsed };
  });
}

describe("ai draft pricing safety fixtures", () => {
  for (const { file, fixture } of loadFixtures()) {
    it(`${fixture.id} (${file})`, () => {
      const serviceDescription = fixture.input.serviceDescription ?? null;
      const knowledgeContext = fixture.input.knowledgeContext ?? null;

      const detection = detectPricingHallucinations(fixture.input.draft, serviceDescription, knowledgeContext);
      const enforced = enforcePricingAmountSafety(fixture.input.draft, serviceDescription, knowledgeContext);

      if (fixture.expected.detection?.hallucinated) {
        assert.deepEqual(
          toSortedNumeric(detection.hallucinated),
          toSortedNumeric(fixture.expected.detection.hallucinated)
        );
      }
      if (fixture.expected.detection?.valid) {
        assert.deepEqual(toSortedNumeric(detection.valid), toSortedNumeric(fixture.expected.detection.valid));
      }
      if (fixture.expected.detection?.cadenceMismatched) {
        assert.deepEqual(
          toSortedNumeric(detection.cadenceMismatched),
          toSortedNumeric(fixture.expected.detection.cadenceMismatched)
        );
      }
      if (fixture.expected.detection?.allDraft) {
        assert.deepEqual(toSortedNumeric(detection.allDraft), toSortedNumeric(fixture.expected.detection.allDraft));
      }

      if (fixture.expected.removedAmounts) {
        assert.deepEqual(toSortedNumeric(enforced.removedAmounts), toSortedNumeric(fixture.expected.removedAmounts));
      }
      if (fixture.expected.removedCadenceAmounts) {
        assert.deepEqual(
          toSortedNumeric(enforced.removedCadenceAmounts),
          toSortedNumeric(fixture.expected.removedCadenceAmounts)
        );
      }
      if (typeof fixture.expected.normalizedCadencePhrase === "boolean") {
        assert.equal(enforced.normalizedCadencePhrase, fixture.expected.normalizedCadencePhrase);
      }
      if (typeof fixture.expected.addedClarifier === "boolean") {
        assert.equal(enforced.addedClarifier, fixture.expected.addedClarifier);
      }

      for (const token of fixture.expected.draftIncludes || []) {
        assert.equal(
          enforced.draft.includes(token),
          true,
          `Expected enforced draft to include "${token}" for fixture ${fixture.id}`
        );
      }
      for (const token of fixture.expected.draftExcludes || []) {
        assert.equal(
          enforced.draft.includes(token),
          false,
          `Expected enforced draft to exclude "${token}" for fixture ${fixture.id}`
        );
      }
    });
  }
});
