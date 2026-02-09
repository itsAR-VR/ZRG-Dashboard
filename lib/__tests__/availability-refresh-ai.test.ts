import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyValidatedReplacements,
  validateAvailabilityReplacements,
} from "../availability-refresh-ai";

describe("applyValidatedReplacements", () => {
  it("replaces multiple ranges in reverse order", () => {
    const draft = "Hi — 9:00 AM EST on Mon, Feb 2 or 3:00 PM EST on Fri, Feb 6.";
    const firstOld = "9:00 AM EST on Mon, Feb 2";
    const secondOld = "3:00 PM EST on Fri, Feb 6";
    const replacements = [
      {
        startIndex: draft.indexOf(firstOld),
        endIndex: draft.indexOf(firstOld) + firstOld.length,
        oldText: firstOld,
        newText: "10:00 AM EST on Tue, Feb 3",
      },
      {
        startIndex: draft.indexOf(secondOld),
        endIndex: draft.indexOf(secondOld) + secondOld.length,
        oldText: secondOld,
        newText: "2:00 PM EST on Thu, Feb 5",
      },
    ];

    const updated = applyValidatedReplacements(draft, replacements);
    assert.equal(
      updated,
      "Hi — 10:00 AM EST on Tue, Feb 3 or 2:00 PM EST on Thu, Feb 5."
    );
  });
});

describe("validateAvailabilityReplacements", () => {
  it("accepts valid replacements", () => {
    const draft = "Time: 9:00 AM EST";
    const oldText = "9:00 AM EST";
    const replacements = [{ oldText, newText: "10:00 AM EST" }];
    const result = validateAvailabilityReplacements({
      draft,
      replacements,
      candidateLabels: new Set(["10:00 AM EST"]),
      usedNewTexts: new Set(),
      chunkSize: 5,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.replacements.length, 1);
      assert.equal(result.replacements[0]!.startIndex, draft.indexOf(oldText));
      assert.equal(result.replacements[0]!.endIndex, draft.indexOf(oldText) + oldText.length);
    }
  });

  it("rejects overlapping ranges", () => {
    const draft = "abcdef";
    const replacements = [
      { oldText: "abcd", newText: "wxyz" },
      { oldText: "cdef", newText: "lmno" },
    ];
    const result = validateAvailabilityReplacements({
      draft,
      replacements,
      candidateLabels: new Set(["wxyz", "lmno"]),
      usedNewTexts: new Set(),
      chunkSize: 5,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "overlapping_ranges");
    }
  });

  it("rejects non-candidate replacements", () => {
    const draft = "Time: 9:00 AM EST";
    const oldText = "9:00 AM EST";
    const replacements = [{ oldText, newText: "11:00 AM EST" }];
    const result = validateAvailabilityReplacements({
      draft,
      replacements,
      candidateLabels: new Set(["10:00 AM EST"]),
      usedNewTexts: new Set(),
      chunkSize: 5,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "new_text_not_candidate");
    }
  });

  it("rejects duplicate newText", () => {
    const draft = "Times: 9:00 AM EST and 3:00 PM EST";
    const first = "9:00 AM EST";
    const second = "3:00 PM EST";
    const replacements = [
      { oldText: first, newText: "10:00 AM EST" },
      { oldText: second, newText: "10:00 AM EST" },
    ];
    const result = validateAvailabilityReplacements({
      draft,
      replacements,
      candidateLabels: new Set(["10:00 AM EST"]),
      usedNewTexts: new Set(),
      chunkSize: 5,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "duplicate_new_text");
    }
  });

  it("rejects oldText when it is not found in draft", () => {
    const draft = "Time: 9:00 AM EST";
    const replacements = [{ oldText: "3:00 PM EST", newText: "10:00 AM EST" }];
    const result = validateAvailabilityReplacements({
      draft,
      replacements,
      candidateLabels: new Set(["10:00 AM EST"]),
      usedNewTexts: new Set(),
      chunkSize: 5,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "old_text_not_found");
    }
  });

  it("rejects oldText when it is not unique in draft", () => {
    const draft = "Times: 9:00 AM EST and again 9:00 AM EST";
    const replacements = [{ oldText: "9:00 AM EST", newText: "10:00 AM EST" }];
    const result = validateAvailabilityReplacements({
      draft,
      replacements,
      candidateLabels: new Set(["10:00 AM EST"]),
      usedNewTexts: new Set(),
      chunkSize: 5,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "old_text_not_unique");
    }
  });
});
