import assert from "node:assert/strict";
import test from "node:test";

import { isTrueSuperAdminUser } from "@/lib/workspace-access";

test("isTrueSuperAdminUser respects SUPER_ADMIN_EMAILS allowlist", () => {
  const prevEmails = process.env.SUPER_ADMIN_EMAILS;
  const prevIds = process.env.SUPER_ADMIN_USER_IDS;
  try {
    process.env.SUPER_ADMIN_EMAILS = "admin@example.com, Other@Example.com ";
    process.env.SUPER_ADMIN_USER_IDS = "";

    assert.equal(isTrueSuperAdminUser({ id: "user-1", email: "admin@example.com" }), true);
    assert.equal(isTrueSuperAdminUser({ id: "user-2", email: "other@example.com" }), true);
    assert.equal(isTrueSuperAdminUser({ id: "user-3", email: "nope@example.com" }), false);
  } finally {
    process.env.SUPER_ADMIN_EMAILS = prevEmails;
    process.env.SUPER_ADMIN_USER_IDS = prevIds;
  }
});

test("isTrueSuperAdminUser respects SUPER_ADMIN_USER_IDS allowlist", () => {
  const prevEmails = process.env.SUPER_ADMIN_EMAILS;
  const prevIds = process.env.SUPER_ADMIN_USER_IDS;
  try {
    process.env.SUPER_ADMIN_EMAILS = "";
    process.env.SUPER_ADMIN_USER_IDS = "abc-123, DEF-456 ";

    assert.equal(isTrueSuperAdminUser({ id: "abc-123", email: null }), true);
    assert.equal(isTrueSuperAdminUser({ id: "def-456", email: null }), true);
    assert.equal(isTrueSuperAdminUser({ id: "zzz-999", email: "admin@example.com" }), false);
  } finally {
    process.env.SUPER_ADMIN_EMAILS = prevEmails;
    process.env.SUPER_ADMIN_USER_IDS = prevIds;
  }
});

