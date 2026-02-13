import assert from "node:assert/strict";
import test from "node:test";

import { classifyLinkedInUrl, mergeLinkedInCompanyUrl, mergeLinkedInUrl } from "@/lib/linkedin-utils";

test("classifyLinkedInUrl classifies profile URLs", () => {
  assert.deepEqual(classifyLinkedInUrl("https://www.linkedin.com/in/jane-doe/?trk=foo"), {
    profileUrl: "https://linkedin.com/in/jane-doe",
    companyUrl: null,
  });
});

test("classifyLinkedInUrl classifies company URLs", () => {
  assert.deepEqual(classifyLinkedInUrl("linkedin.com/company/acme-inc/about/"), {
    profileUrl: null,
    companyUrl: "https://linkedin.com/company/acme-inc",
  });
});

test("classifyLinkedInUrl rejects non-linkedin URLs", () => {
  assert.deepEqual(classifyLinkedInUrl("https://example.com/users/jane"), {
    profileUrl: null,
    companyUrl: null,
  });
});

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

test("mergeLinkedInUrl ignores company URL when profile is missing", () => {
  assert.equal(mergeLinkedInUrl(null, "https://linkedin.com/company/acme"), null);
});

test("mergeLinkedInCompanyUrl stores company URL as fill-only", () => {
  assert.equal(
    mergeLinkedInCompanyUrl(null, "https://www.linkedin.com/company/acme-inc/?trk=foo"),
    "https://linkedin.com/company/acme-inc"
  );
});

test("mergeLinkedInCompanyUrl keeps existing company URL", () => {
  assert.equal(
    mergeLinkedInCompanyUrl(
      "https://linkedin.com/company/existing-company",
      "https://linkedin.com/company/new-company"
    ),
    "https://linkedin.com/company/existing-company"
  );
});
