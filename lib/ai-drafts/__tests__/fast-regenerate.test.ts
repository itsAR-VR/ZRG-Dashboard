import assert from "node:assert/strict";
import test from "node:test";

import { FAST_REGEN_CHAR_LIMITS, clampFastRegenOutputForChannel, pickCycledEmailArchetypeId } from "../fast-regenerate";

test("pickCycledEmailArchetypeId cycles deterministically across clicks", () => {
  const seed = "seed-1";

  const id0 = pickCycledEmailArchetypeId({ cycleSeed: seed, regenCount: 0 });
  const id1 = pickCycledEmailArchetypeId({ cycleSeed: seed, regenCount: 1 });
  const id10 = pickCycledEmailArchetypeId({ cycleSeed: seed, regenCount: 10 });

  assert.ok(typeof id0 === "string" && id0.length > 0);
  assert.ok(typeof id1 === "string" && id1.length > 0);
  assert.notEqual(id0, id1);
  assert.equal(id0, id10);
});

test("clampFastRegenOutputForChannel clamps SMS output to max chars", () => {
  const input = "a".repeat(FAST_REGEN_CHAR_LIMITS.sms + 50);
  const output = clampFastRegenOutputForChannel(input, "sms");
  assert.equal(output.length, FAST_REGEN_CHAR_LIMITS.sms);
});

test("clampFastRegenOutputForChannel clamps LinkedIn output to max chars", () => {
  const input = "b".repeat(FAST_REGEN_CHAR_LIMITS.linkedin + 50);
  const output = clampFastRegenOutputForChannel(input, "linkedin");
  assert.equal(output.length, FAST_REGEN_CHAR_LIMITS.linkedin);
});

test("clampFastRegenOutputForChannel trims email output without clamping", () => {
  const input = "  hello  ";
  const output = clampFastRegenOutputForChannel(input, "email");
  assert.equal(output, "hello");
});

