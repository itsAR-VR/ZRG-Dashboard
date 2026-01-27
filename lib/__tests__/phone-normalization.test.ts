import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePhoneE164ForGhl } from "../phone-normalization";
import { toStoredPhone } from "../phone-utils";

describe("resolvePhoneE164ForGhl", () => {
  it("accepts explicit +E.164 numbers", async () => {
    const result = await resolvePhoneE164ForGhl({
      clientId: "client-1",
      leadId: "lead-1",
      phone: "+6581234567",
    });

    assert.equal(result.ok, true);
    assert.equal(result.e164, "+6581234567");
  });

  it("normalizes 00-prefix international numbers", async () => {
    const result = await resolvePhoneE164ForGhl({
      clientId: "client-1",
      phone: "006581234567",
    });

    assert.equal(result.ok, true);
    assert.equal(result.e164, "+6581234567");
  });

  it("accepts digits that already include a valid calling code (stored without '+')", async () => {
    const result = await resolvePhoneE164ForGhl({
      clientId: "client-1",
      phone: "6581234567",
    });

    assert.equal(result.ok, true);
    assert.equal(result.e164, "+6581234567");
  });

  it("parses national-format numbers with deterministic region signals (UK)", async () => {
    const result = await resolvePhoneE164ForGhl({
      clientId: "client-1",
      phone: "07911123456",
      companyWebsite: "https://example.co.uk",
    });

    assert.equal(result.ok, true);
    assert.equal(result.e164, "+447911123456");
  });

  it("does not invent a country calling code for ambiguous 11-digit nationals", async () => {
    const result = await resolvePhoneE164ForGhl({
      clientId: "client-1",
      phone: "11987654321",
    });

    assert.equal(result.ok, false);
    assert.equal(result.e164, null);
  });
});

describe("toStoredPhone", () => {
  it("stores explicit international numbers as +E.164-ish", () => {
    assert.equal(toStoredPhone("+14155552671"), "+14155552671");
  });

  it("stores NANP numbers with a leading 1 as +E.164-ish", () => {
    assert.equal(toStoredPhone("14155552671"), "+14155552671");
  });

  it("does not promote 11-digit national numbers to '+' without an explicit prefix", () => {
    assert.equal(toStoredPhone("11987654321"), "11987654321");
  });
});

