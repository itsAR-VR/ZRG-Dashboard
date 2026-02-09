import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanEmailBody, stripEmailQuotedSectionsForAutomation, stripNullBytes } from "../email-cleaning";

describe("stripNullBytes", () => {
  it("removes embedded null bytes from strings", () => {
    assert.equal(stripNullBytes("hel\u0000lo"), "hello");
  });

  it("preserves undefined and null semantics", () => {
    assert.equal(stripNullBytes(undefined), undefined);
    assert.equal(stripNullBytes(null), undefined);
  });
});

describe("cleanEmailBody", () => {
  it("sanitizes null bytes from text and html payloads", () => {
    const result = cleanEmailBody("<p>hi\u0000 there</p>", "hello\u0000 world");
    assert.equal(result.cleaned, "hello world");
    assert.equal(result.rawText, "hello world");
    assert.equal(result.rawHtml, "<p>hi there</p>");
  });

  it("sanitizes html-only payloads", () => {
    const result = cleanEmailBody("<div>Hello\u0000<br/>World</div>", null);
    assert.equal(result.cleaned, "Hello\nWorld");
    assert.equal(result.rawHtml, "<div>Hello<br/>World</div>");
  });

  it("strips Gmail-style quoted threads where 'On ... wrote:' spans lines", () => {
    const textBody = [
      "Hi Johnathan,",
      "",
      "We are currently not looking to sell, but if you'd like, you may provide us",
      "with more information on your valuation approach.",
      "",
      "Thanks.",
      "",
      "On Fri, Feb 6, 2026 at 11:21 AM Johnathan Choe",
      "wrote:",
      "> Hello Christopher,",
      "> Are you free Fri, Feb 13 at 12:00 PM EST?",
    ].join("\n");

    const result = cleanEmailBody(null, textBody);
    assert.equal(
      result.cleaned,
      [
        "Hi Johnathan,",
        "",
        "We are currently not looking to sell, but if you'd like, you may provide us",
        "with more information on your valuation approach.",
        "",
        "Thanks.",
      ].join("\n")
    );
  });

  it("strips forwarded message blocks", () => {
    const textBody = [
      "Sure, see below.",
      "",
      "Begin forwarded message:",
      "From: Someone <someone@example.com>",
      "Subject: Fwd: Hello",
      "",
      "body",
    ].join("\n");

    const result = cleanEmailBody(null, textBody);
    assert.equal(result.cleaned, "Sure, see below.");
  });
});

describe("stripEmailQuotedSectionsForAutomation", () => {
  it("removes quoted thread boundaries across lines", () => {
    const input = ["Hello", "", "On Mon, Jan 6, 2025 at 10:00 AM", "wrote:", "Quoted"].join("\n");
    assert.equal(stripEmailQuotedSectionsForAutomation(input), "Hello");
  });
});
