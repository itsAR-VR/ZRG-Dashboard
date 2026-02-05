import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractPrimaryWebsiteUrlFromAssets,
  normalizeWebsiteUrl,
  PRIMARY_WEBSITE_ASSET_NAME,
} from "../knowledge-asset-context";

describe("normalizeWebsiteUrl", () => {
  it("normalizes URLs and adds scheme when missing", () => {
    assert.equal(normalizeWebsiteUrl("www.example.com"), "https://www.example.com");
    assert.equal(normalizeWebsiteUrl("https://example.com/"), "https://example.com");
    assert.equal(normalizeWebsiteUrl("Our site is https://example.com/about"), "https://example.com/about");
  });

  it("returns null for empty or invalid input", () => {
    assert.equal(normalizeWebsiteUrl(""), null);
    assert.equal(normalizeWebsiteUrl("not a url"), null);
  });
});

describe("extractPrimaryWebsiteUrlFromAssets", () => {
  it("extracts the primary website URL from assets", () => {
    const assets = [
      { name: "Other", textContent: "Ignore me", fileUrl: null, type: "text" },
      { name: PRIMARY_WEBSITE_ASSET_NAME, textContent: "https://example.com", fileUrl: null, type: "text" },
    ];

    assert.equal(extractPrimaryWebsiteUrlFromAssets(assets), "https://example.com");
  });

  it("returns null when primary asset is missing", () => {
    const assets = [{ name: "General Notes", textContent: "Notes", fileUrl: null, type: "text" }];
    assert.equal(extractPrimaryWebsiteUrlFromAssets(assets), null);
  });
});
