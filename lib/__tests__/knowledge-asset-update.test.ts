import assert from "node:assert/strict";
import test from "node:test";

import { buildKnowledgeAssetUpdateData } from "@/lib/knowledge-asset-update";

test("knowledge asset update: trims name and updates text for text assets", () => {
  const result = buildKnowledgeAssetUpdateData("text", {
    name: "  Pricing Guide  ",
    textContent: "Updated notes",
    fileUrl: "https://example.com/ignored",
  });

  assert.equal(result.error, undefined);
  assert.equal(result.updateData.name, "Pricing Guide");
  assert.equal(result.updateData.textContent, "Updated notes");
  assert.equal(result.updateData.fileUrl, undefined);
});

test("knowledge asset update: rejects blank names", () => {
  const result = buildKnowledgeAssetUpdateData("file", {
    name: "   ",
  });

  assert.equal(result.error, "Asset name is required");
});

test("knowledge asset update: validates and normalizes URL for url assets", () => {
  const result = buildKnowledgeAssetUpdateData("url", {
    fileUrl: "https://example.com/pricing",
  });

  assert.equal(result.error, undefined);
  assert.equal(result.updateData.fileUrl, "https://example.com/pricing");
});

test("knowledge asset update: rejects non-http urls", () => {
  const result = buildKnowledgeAssetUpdateData("url", {
    fileUrl: "ftp://example.com/pricing",
  });

  assert.equal(result.error, "Only http(s) URLs are supported");
});

test("knowledge asset update: rejects private network hosts", () => {
  const result = buildKnowledgeAssetUpdateData("url", {
    fileUrl: "http://localhost:3000/secret",
  });

  assert.equal(result.error, "URL hostname is not allowed");
});

test("knowledge asset update: rejects malformed urls", () => {
  const result = buildKnowledgeAssetUpdateData("url", {
    fileUrl: "not a url",
  });

  assert.equal(result.error, "Invalid URL");
});
