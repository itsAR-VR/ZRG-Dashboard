import assert from "node:assert/strict";
import test from "node:test";

import { mergeLinkedInUrl } from "@/lib/linkedin-utils";

test("mergeLinkedInUrl keeps incoming profile over existing company", () => {
  assert.equal(
    mergeLinkedInUrl("https://www.linkedin.com/company/acme", "https://linkedin.com/in/jane-doe"),
    "https://linkedin.com/in/jane-doe"
  );
});

test("mergeLinkedInUrl keeps existing profile over incoming company", () => {
  assert.equal(
    mergeLinkedInUrl("https://linkedin.com/in/jane-doe", "https://linkedin.com/company/acme"),
    "https://linkedin.com/in/jane-doe"
  );
});

test("mergeLinkedInUrl keeps existing value when both profiles", () => {
  assert.equal(
    mergeLinkedInUrl("https://linkedin.com/in/jane-doe", "https://linkedin.com/in/jane-doe-alt"),
    "https://linkedin.com/in/jane-doe"
  );
});
