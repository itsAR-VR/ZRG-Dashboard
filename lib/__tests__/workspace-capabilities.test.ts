import assert from "node:assert/strict";
import test from "node:test";

import { ClientMemberRole } from "@prisma/client";
import { getCapabilitiesForRole } from "../workspace-capabilities";

test("workspace capabilities allow admin roles to edit settings and view observability", () => {
  const ownerCaps = getCapabilitiesForRole("OWNER");
  assert.equal(ownerCaps.canEditSettings, true);
  assert.equal(ownerCaps.canEditAiPersonality, true);
  assert.equal(ownerCaps.canViewAiObservability, true);
  assert.equal(ownerCaps.canManageMembers, true);
  assert.equal(ownerCaps.isClientPortalUser, false);

  const adminCaps = getCapabilitiesForRole(ClientMemberRole.ADMIN);
  assert.equal(adminCaps.canEditSettings, true);
  assert.equal(adminCaps.canEditAiPersonality, true);
  assert.equal(adminCaps.canViewAiObservability, true);
  assert.equal(adminCaps.canManageMembers, true);
});

test("workspace capabilities restrict client portal users", () => {
  const clientCaps = getCapabilitiesForRole(ClientMemberRole.CLIENT_PORTAL);
  assert.equal(clientCaps.isClientPortalUser, true);
  assert.equal(clientCaps.canEditSettings, false);
  assert.equal(clientCaps.canEditAiPersonality, false);
  assert.equal(clientCaps.canViewAiObservability, false);
  assert.equal(clientCaps.canManageMembers, false);
});

test("workspace capabilities restrict non-admin internal roles", () => {
  const inboxCaps = getCapabilitiesForRole(ClientMemberRole.INBOX_MANAGER);
  assert.equal(inboxCaps.canEditSettings, false);
  assert.equal(inboxCaps.canViewAiObservability, false);

  const setterCaps = getCapabilitiesForRole(ClientMemberRole.SETTER);
  assert.equal(setterCaps.canEditSettings, false);
  assert.equal(setterCaps.canViewAiObservability, false);
});
