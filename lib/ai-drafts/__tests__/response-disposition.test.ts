import assert from "node:assert/strict";
import test from "node:test";

import { computeAIDraftResponseDisposition } from "../response-disposition";

test("sentBy=ai returns AUTO_SENT", () => {
  const result = computeAIDraftResponseDisposition({
    sentBy: "ai",
    draftContent: "hello",
    finalContent: "hello",
  });
  assert.equal(result, "AUTO_SENT");
});

test("sentBy=ai with edited content still returns AUTO_SENT", () => {
  const result = computeAIDraftResponseDisposition({
    sentBy: "ai",
    draftContent: "hello",
    finalContent: "hello there",
  });
  assert.equal(result, "AUTO_SENT");
});

test("sentBy=setter with identical content returns APPROVED", () => {
  const result = computeAIDraftResponseDisposition({
    sentBy: "setter",
    draftContent: "hello",
    finalContent: "hello",
  });
  assert.equal(result, "APPROVED");
});

test("sentBy=setter with different content returns EDITED", () => {
  const result = computeAIDraftResponseDisposition({
    sentBy: "setter",
    draftContent: "hello",
    finalContent: "hello there",
  });
  assert.equal(result, "EDITED");
});

test("sentBy=null defaults to setter logic", () => {
  const result = computeAIDraftResponseDisposition({
    sentBy: null,
    draftContent: "hello",
    finalContent: "hello there",
  });
  assert.equal(result, "EDITED");
});

test("whitespace-only difference counts as EDITED", () => {
  const result = computeAIDraftResponseDisposition({
    sentBy: "setter",
    draftContent: "hello",
    finalContent: "hello ",
  });
  assert.equal(result, "EDITED");
});
