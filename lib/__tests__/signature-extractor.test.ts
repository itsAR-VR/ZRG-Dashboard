import assert from "node:assert/strict";
import test from "node:test";
import {
  extractContactFromMessageContent,
} from "@/lib/signature-extractor";

test("extractContactFromMessageContent captures LinkedIn company URLs for separate routing", () => {
  const result = extractContactFromMessageContent("Let's connect on https://www.linkedin.com/company/acme-corp here.");

  assert.equal(result.linkedinUrl, "https://linkedin.com/company/acme-corp");
  assert.equal(result.foundInMessage, true);
});
