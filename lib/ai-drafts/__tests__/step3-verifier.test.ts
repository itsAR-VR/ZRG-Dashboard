import assert from "node:assert/strict";
import test from "node:test";

import { enforceCanonicalBookingLink, replaceEmDashesWithCommaSpace } from "../step3-verifier";

test("replaceEmDashesWithCommaSpace replaces em-dash with comma+space", () => {
  const input = "Closest slot is Jan 24—could you do that?";
  const output = replaceEmDashesWithCommaSpace(input);
  assert.equal(output, "Closest slot is Jan 24, could you do that?");
});

test("replaceEmDashesWithCommaSpace avoids space before comma", () => {
  const input = "Thanks for reaching out — happy to help.";
  const output = replaceEmDashesWithCommaSpace(input);
  assert.equal(output, "Thanks for reaching out, happy to help.");
});

test("enforceCanonicalBookingLink replaces [Calendly link] placeholder", () => {
  const canonical = "https://calendly.com/d/cx6g-rr7-zkd/intro-call-with-fc";
  const input = "Grab a time here: [Calendly link].";
  const output = enforceCanonicalBookingLink(input, canonical);
  assert.equal(output, `Grab a time here: ${canonical}.`);
});

test("enforceCanonicalBookingLink replaces wrong calendly link with canonical", () => {
  const canonical = "https://calendly.com/d/cx6g-rr7-zkd/intro-call-with-fc";
  const input = "Book here: https://calendly.com/d/cx6g-rr7-zdk/intro-call-with-fc";
  const output = enforceCanonicalBookingLink(input, canonical);
  assert.equal(output, `Book here: ${canonical}`);
});

test("enforceCanonicalBookingLink replaces GHL widget booking link with canonical", () => {
  const canonical = "https://book.example.com/widget/booking/abc123?foo=bar";
  const input = "Book here: https://old-domain.example/widget/bookings/xyz987?utm=1.";
  const output = enforceCanonicalBookingLink(input, canonical);
  assert.equal(output, `Book here: ${canonical}.`);
});

test("enforceCanonicalBookingLink does not replace arbitrary URLs by default", () => {
  const canonical = "https://book.example.com/meeting";
  const input = "See details: https://example.com/docs.";
  const output = enforceCanonicalBookingLink(input, canonical);
  assert.equal(output, input);
});

test("enforceCanonicalBookingLink replaces any http(s) URL when replaceAllUrls is set", () => {
  const canonical = "https://book.example.com/meeting";
  const input = "Links: https://example.com/docs and https://another.example/path.";
  const output = enforceCanonicalBookingLink(input, canonical, { replaceAllUrls: true });
  assert.equal(output, `Links: ${canonical} and ${canonical}.`);
});

test("enforceCanonicalBookingLink removes booking widget links when canonical is missing", () => {
  const input = "Book here: https://old-domain.example/widget/booking/xyz987.";
  const output = enforceCanonicalBookingLink(input, null);
  assert.equal(output, "Book here: .");
});
