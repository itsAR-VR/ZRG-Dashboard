import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHotLeadWhere,
  buildProviderEligibilityWhere,
  buildWarmLeadWhere,
  getHotCutoff,
} from "../appointment-reconcile-runner";

describe("appointment reconciliation eligibility helpers", () => {
  it("computes hot cutoff in minutes", () => {
    const now = new Date("2026-02-03T10:00:00.000Z");
    const cutoff = getHotCutoff(now, 1);
    assert.equal(cutoff.toISOString(), "2026-02-03T09:59:00.000Z");
  });

  it("buildHotLeadWhere includes follow-up instance requirement and no lastInboundAt", () => {
    const where = buildHotLeadWhere({
      clientId: "client-1",
      provider: "GHL",
      hotCutoff: new Date("2026-02-03T10:00:00.000Z"),
    });

    const conditions = (where.AND ?? []) as any[];
    assert.ok(conditions.some((cond) => cond.followUpInstances?.some?.status === "active"));
    assert.ok(!conditions.some((cond) => "lastInboundAt" in cond));
  });

  it("buildWarmLeadWhere requires inbound replies", () => {
    const where = buildWarmLeadWhere({
      clientId: "client-1",
      provider: "GHL",
      staleCutoff: new Date("2026-02-01T10:00:00.000Z"),
    });

    const conditions = (where.AND ?? []) as any[];
    assert.ok(conditions.some((cond) => cond.lastInboundAt?.not === null));
  });

  it("provider eligibility allows email and appointment ID for GHL", () => {
    const where = buildProviderEligibilityWhere("GHL");
    const options = (where.OR ?? []) as any[];

    assert.ok(options.some((cond) => "ghlContactId" in cond));
    assert.ok(options.some((cond) => "email" in cond));
    assert.ok(options.some((cond) => "ghlAppointmentId" in cond));
  });

  it("provider eligibility requires email for Calendly", () => {
    const where = buildProviderEligibilityWhere("CALENDLY");
    assert.deepEqual(where, { email: { not: null } });
  });

  it("buildHotLeadWhere applies excludeIds when provided", () => {
    const where = buildHotLeadWhere({
      clientId: "client-1",
      provider: "CALENDLY",
      hotCutoff: new Date("2026-02-03T10:00:00.000Z"),
      excludeIds: ["lead-1", "lead-2"],
    });

    const conditions = (where.AND ?? []) as any[];
    assert.ok(conditions.some((cond) => cond.id?.notIn?.length === 2));
  });
});
