import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanEmailBody, stripNullBytes } from "../email-cleaning";

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
});
