import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { provisionWorkspaceMemberCore, type WorkspaceMemberProvisionDeps } from "../../actions/workspace-member-provisioning-actions";

const baseDeps: WorkspaceMemberProvisionDeps = {
  requireClientAdminAccess: async () => ({ userId: "admin-1", userEmail: "admin@example.com" }),
  resolveSupabaseUserIdByEmail: async () => null,
  createSupabaseAdminClient: () =>
    ({
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
        },
      },
    }) as any,
  sendResendEmail: async () => ({ success: true }),
  getPublicAppUrl: () => "https://app.example.com",
  getWorkspaceEmailConfig: async () => ({
    workspaceName: "ZRG",
    brandName: "ZRG",
    resendApiKey: "rk_test",
    resendFromEmail: "from@zrg.com",
  }),
  createClientMember: async () => ({ created: true }),
};

describe("provisionWorkspaceMemberCore", () => {
  it("creates a new user, sends email, and adds membership", async () => {
    let createUserCalls = 0;
    let sendEmailCalls = 0;

    const deps: WorkspaceMemberProvisionDeps = {
      ...baseDeps,
      createSupabaseAdminClient: () =>
        ({
          auth: {
            admin: {
              createUser: async () => {
                createUserCalls += 1;
                return { data: { user: { id: "user-123" } }, error: null };
              },
            },
          },
        }) as any,
      sendResendEmail: async () => {
        sendEmailCalls += 1;
        return { success: true };
      },
    };

    const result = await provisionWorkspaceMemberCore(deps, "client-1", {
      email: "setter@example.com",
      role: "SETTER",
    });

    assert.equal(result.success, true);
    assert.equal(result.userExisted, false);
    assert.equal(result.emailSent, true);
    assert.equal(result.membershipCreated, true);
    assert.equal(result.userId, "user-123");
    assert.equal(createUserCalls, 1);
    assert.equal(sendEmailCalls, 1);
  });

  it("adds membership only for existing users without emailing", async () => {
    let createClientCalls = 0;
    let sendEmailCalls = 0;

    const deps: WorkspaceMemberProvisionDeps = {
      ...baseDeps,
      resolveSupabaseUserIdByEmail: async () => "user-existing",
      createSupabaseAdminClient: () => {
        createClientCalls += 1;
        return baseDeps.createSupabaseAdminClient();
      },
      sendResendEmail: async () => {
        sendEmailCalls += 1;
        return { success: true };
      },
    };

    const result = await provisionWorkspaceMemberCore(deps, "client-1", {
      email: "existing@example.com",
      role: "INBOX_MANAGER",
    });

    assert.equal(result.success, true);
    assert.equal(result.userExisted, true);
    assert.equal(result.emailSent, false);
    assert.equal(result.membershipCreated, true);
    assert.equal(result.userId, "user-existing");
    assert.equal(createClientCalls, 0);
    assert.equal(sendEmailCalls, 0);
  });

  it("rejects invalid roles", async () => {
    const result = await provisionWorkspaceMemberCore(baseDeps, "client-1", {
      email: "setter@example.com",
      role: "ADMIN" as any,
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Role must be SETTER or INBOX_MANAGER");
  });

  it("rejects invalid emails", async () => {
    const result = await provisionWorkspaceMemberCore(baseDeps, "client-1", {
      email: "   ",
      role: "SETTER",
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Invalid email address");
  });

  it("fails when Resend is not configured for new users", async () => {
    const deps: WorkspaceMemberProvisionDeps = {
      ...baseDeps,
      getWorkspaceEmailConfig: async () => ({
        workspaceName: "ZRG",
        brandName: "ZRG",
        resendApiKey: null,
        resendFromEmail: null,
      }),
    };

    const result = await provisionWorkspaceMemberCore(deps, "client-1", {
      email: "setter@example.com",
      role: "SETTER",
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Resend is not configured for this workspace");
  });

  it("returns success when membership already exists", async () => {
    const deps: WorkspaceMemberProvisionDeps = {
      ...baseDeps,
      resolveSupabaseUserIdByEmail: async () => "user-existing",
      createClientMember: async () => ({ created: false }),
    };

    const result = await provisionWorkspaceMemberCore(deps, "client-1", {
      email: "existing@example.com",
      role: "SETTER",
    });

    assert.equal(result.success, true);
    assert.equal(result.membershipCreated, false);
  });
});
