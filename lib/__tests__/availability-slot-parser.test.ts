import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractAvailabilitySection, replaceAvailabilitySlotsInContent } from "../availability-slot-parser";

describe("availability-slot-parser", () => {
  it("replaces slots for SMS/LinkedIn header while preserving prose", () => {
    const content = [
      "Hi there,",
      "",
      "Available times (use verbatim if proposing times):",
      "- 2:30 PM EST on Wed, Feb 5",
      "- 4:00 PM EST on Thu, Feb 6",
      "",
      "Let me know which works.",
    ].join("\n");

    const updated = replaceAvailabilitySlotsInContent(content, [
      "10:00 AM EST on Fri, Feb 7",
      "1:15 PM EST on Mon, Feb 10",
    ]);

    const expected = [
      "Hi there,",
      "",
      "Available times (use verbatim if proposing times):",
      "- 10:00 AM EST on Fri, Feb 7",
      "- 1:15 PM EST on Mon, Feb 10",
      "",
      "Let me know which works.",
    ].join("\n");

    assert.equal(updated, expected);
  });

  it("replaces slots for Email header while preserving header casing", () => {
    const content = [
      "Thanks for reaching out.",
      "",
      "AVAILABLE TIMES (use verbatim if scheduling):",
      "- 9:00 AM PST on Tue, Feb 11",
      "- 3:30 PM PST on Wed, Feb 12",
    ].join("\n");

    const updated = replaceAvailabilitySlotsInContent(content, [
      "11:00 AM PST on Thu, Feb 13",
      "2:45 PM PST on Fri, Feb 14",
    ]);

    const expected = [
      "Thanks for reaching out.",
      "",
      "AVAILABLE TIMES (use verbatim if scheduling):",
      "- 11:00 AM PST on Thu, Feb 13",
      "- 2:45 PM PST on Fri, Feb 14",
    ].join("\n");

    assert.equal(updated, expected);
  });

  it("preserves CRLF line endings", () => {
    const content = [
      "Hello,",
      "",
      "Available times (use verbatim if proposing times):",
      "- 8:00 AM EST on Mon, Feb 17",
      "- 2:00 PM EST on Tue, Feb 18",
      "",
      "Thanks.",
    ].join("\r\n");

    const updated = replaceAvailabilitySlotsInContent(content, ["9:30 AM EST on Wed, Feb 19"]);

    const expected = [
      "Hello,",
      "",
      "Available times (use verbatim if proposing times):",
      "- 9:30 AM EST on Wed, Feb 19",
      "",
      "Thanks.",
    ].join("\r\n");

    assert.equal(updated, expected);
  });

  it("returns null when no availability section exists", () => {
    const content = "Just checking in.";
    assert.equal(extractAvailabilitySection(content), null);
  });

  it("throws when replacing without an availability section", () => {
    assert.throws(() => replaceAvailabilitySlotsInContent("No slots here.", ["10:00 AM"]));
  });

  it("replaces only the first availability section when multiple exist", () => {
    const content = [
      "Available times (use verbatim if proposing times):",
      "- 1:00 PM EST on Mon, Feb 24",
      "",
      "Follow-up details below.",
      "",
      "AVAILABLE TIMES (use verbatim if scheduling):",
      "- 9:00 AM EST on Tue, Feb 25",
    ].join("\n");

    const updated = replaceAvailabilitySlotsInContent(content, ["3:15 PM EST on Wed, Feb 26"]);

    const expected = [
      "Available times (use verbatim if proposing times):",
      "- 3:15 PM EST on Wed, Feb 26",
      "",
      "Follow-up details below.",
      "",
      "AVAILABLE TIMES (use verbatim if scheduling):",
      "- 9:00 AM EST on Tue, Feb 25",
    ].join("\n");

    assert.equal(updated, expected);
  });
});
