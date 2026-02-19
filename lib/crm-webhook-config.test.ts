import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCrmWebhookDispatchSkipReason,
  getCrmWebhookSecretSet,
  normalizeCrmWebhookSettingsPatch,
  normalizeStoredCrmWebhookEvents,
  resolveCrmWebhookDispatchConfig,
} from "@/lib/crm-webhook-config";

describe("crm-webhook-config", () => {
  it("normalizes valid webhook config patch", () => {
    const result = normalizeCrmWebhookSettingsPatch({
      crmWebhookEnabled: true,
      crmWebhookUrl: "https://example.com/hook ",
      crmWebhookEvents: ["lead_created", "crm_row_updated", "lead_created"],
      crmWebhookSecret: "  super-secret  ",
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.values, {
      crmWebhookEnabled: true,
      crmWebhookUrl: "https://example.com/hook",
      crmWebhookEvents: ["lead_created", "crm_row_updated"],
      crmWebhookSecret: "super-secret",
    });
  });

  it("rejects non-https and private-network webhook URLs", () => {
    const insecure = normalizeCrmWebhookSettingsPatch({ crmWebhookUrl: "http://example.com/hook" });
    assert.equal(insecure.error, "crmWebhookUrl must use https://");

    const privateHost = normalizeCrmWebhookSettingsPatch({ crmWebhookUrl: "https://127.0.0.1/hook" });
    assert.equal(privateHost.error, "crmWebhookUrl hostname is not allowed");
  });

  it("normalizes stored events defensively", () => {
    const events = normalizeStoredCrmWebhookEvents(["lead_created", "unknown", "crm_row_updated", "lead_created"]);
    assert.deepEqual(events, ["lead_created", "crm_row_updated"]);
  });

  it("derives dispatch skip reasons from normalized settings", () => {
    const config = resolveCrmWebhookDispatchConfig({
      crmWebhookEnabled: true,
      crmWebhookUrl: "https://example.com/hook",
      crmWebhookEvents: ["lead_created"],
      crmWebhookSecret: "secret",
    });
    assert.equal(getCrmWebhookDispatchSkipReason(config, "lead_created"), null);
    assert.equal(getCrmWebhookDispatchSkipReason(config, "crm_row_updated"), "event_not_enabled");
  });

  it("tracks whether secret is configured without exposing it", () => {
    assert.equal(getCrmWebhookSecretSet("secret"), true);
    assert.equal(getCrmWebhookSecretSet("   "), false);
    assert.equal(getCrmWebhookSecretSet(null), false);
  });
});
