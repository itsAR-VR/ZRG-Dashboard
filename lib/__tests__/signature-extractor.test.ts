import assert from "node:assert/strict";
import test from "node:test";
import {
  extractContactFromMessageContent,
} from "@/lib/signature-extractor";

test("extractContactFromMessageContent ignores LinkedIn company URLs", () => {
  const result = extractContactFromMessageContent("Let's connect on https://www.linkedin.com/company/acme-corp here.");

  assert.equal(result.linkedinUrl, null);
  assert.equal(result.foundInMessage, true);
});

