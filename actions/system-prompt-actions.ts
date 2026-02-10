"use server";

import { prisma } from "@/lib/prisma";
import { requireSuperAdminUser } from "@/lib/workspace-access";
import { computePromptMessageBaseHash, type PromptRole } from "@/lib/ai/prompt-registry";
import { SNIPPET_DEFAULTS } from "@/lib/ai/prompt-snippets";

export type SystemPromptOverrideInput = {
  promptKey: string;
  role: PromptRole;
  index: number;
  content: string;
};

export type SystemPromptOverrideRecord = {
  id: string;
  promptKey: string;
  role: string;
  index: number;
  content: string;
  baseContentHash: string;
  updatedAt: string;
};

export type SystemPromptOverrideRevisionRecord = {
  id: string;
  promptKey: string;
  role: string;
  index: number;
  content: string | null;
  action: string;
  createdAt: Date;
  createdByEmail: string | null;
};

export async function getSystemPromptOverrides(params?: {
  promptKey?: string | null;
}): Promise<{ success: boolean; data?: SystemPromptOverrideRecord[]; error?: string }> {
  try {
    await requireSuperAdminUser();

    const rows = await prisma.systemPromptOverride.findMany({
      where: params?.promptKey ? { promptKey: params.promptKey } : undefined,
      orderBy: [{ promptKey: "asc" }, { role: "asc" }, { index: "asc" }],
      select: {
        id: true,
        promptKey: true,
        role: true,
        index: true,
        content: true,
        baseContentHash: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        promptKey: r.promptKey,
        role: r.role,
        index: r.index,
        content: r.content,
        baseContentHash: r.baseContentHash,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load system prompt overrides" };
  }
}

export async function saveSystemPromptOverride(
  override: SystemPromptOverrideInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireSuperAdminUser();

    const baseContentHash = computePromptMessageBaseHash({
      promptKey: override.promptKey,
      role: override.role,
      index: override.index,
    });

    if (!baseContentHash) {
      return {
        success: false,
        error: `Invalid prompt message: ${override.promptKey} ${override.role}[${override.index}] does not exist`,
      };
    }

    const saved = await prisma.systemPromptOverride.upsert({
      where: {
        promptKey_role_index: {
          promptKey: override.promptKey,
          role: override.role,
          index: override.index,
        },
      },
      create: {
        promptKey: override.promptKey,
        role: override.role,
        index: override.index,
        baseContentHash,
        content: override.content,
      },
      update: {
        baseContentHash,
        content: override.content,
      },
      select: { id: true },
    });

    await prisma.systemPromptOverrideRevision.create({
      data: {
        systemPromptOverrideId: saved.id,
        promptKey: override.promptKey,
        role: override.role,
        index: override.index,
        baseContentHash,
        content: override.content,
        action: "UPSERT",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[saveSystemPromptOverride] Error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to save system prompt override" };
  }
}

export async function resetSystemPromptOverride(params: {
  promptKey: string;
  role: string;
  index: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireSuperAdminUser();

    const existing = await prisma.systemPromptOverride.findFirst({
      where: { promptKey: params.promptKey, role: params.role, index: params.index },
      select: { id: true, baseContentHash: true, content: true },
    });

    await prisma.systemPromptOverride.deleteMany({
      where: { promptKey: params.promptKey, role: params.role, index: params.index },
    });

    if (existing) {
      await prisma.systemPromptOverrideRevision.create({
        data: {
          systemPromptOverrideId: existing.id,
          promptKey: params.promptKey,
          role: params.role,
          index: params.index,
          baseContentHash: existing.baseContentHash,
          content: existing.content,
          action: "RESET",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("[resetSystemPromptOverride] Error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to reset system prompt override" };
  }
}

export async function getSystemPromptOverrideRevisions(params: {
  promptKey: string;
  role: string;
  index: number;
}): Promise<{ success: boolean; data?: SystemPromptOverrideRevisionRecord[]; error?: string }> {
  try {
    await requireSuperAdminUser();

    const revisions = await prisma.systemPromptOverrideRevision.findMany({
      where: { promptKey: params.promptKey, role: params.role, index: params.index },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        promptKey: true,
        role: true,
        index: true,
        content: true,
        action: true,
        createdAt: true,
        createdByEmail: true,
      },
    });

    return { success: true, data: revisions };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load system prompt history" };
  }
}

export async function rollbackSystemPromptOverrideRevision(params: {
  revisionId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireSuperAdminUser();

    const revision = await prisma.systemPromptOverrideRevision.findFirst({
      where: { id: params.revisionId },
      select: { promptKey: true, role: true, index: true, content: true },
    });
    if (!revision) return { success: false, error: "Revision not found" };

    if (!revision.content) {
      await prisma.systemPromptOverride.deleteMany({
        where: { promptKey: revision.promptKey, role: revision.role, index: revision.index },
      });
      await prisma.systemPromptOverrideRevision.create({
        data: {
          promptKey: revision.promptKey,
          role: revision.role,
          index: revision.index,
          content: null,
          action: "ROLLBACK_DELETE",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
      return { success: true };
    }

    const baseContentHash = computePromptMessageBaseHash({
      promptKey: revision.promptKey,
      role: revision.role as PromptRole,
      index: revision.index,
    });
    if (!baseContentHash) {
      return { success: false, error: "Prompt target invalid" };
    }

    const override = await prisma.systemPromptOverride.upsert({
      where: {
        promptKey_role_index: {
          promptKey: revision.promptKey,
          role: revision.role,
          index: revision.index,
        },
      },
      create: {
        promptKey: revision.promptKey,
        role: revision.role,
        index: revision.index,
        baseContentHash,
        content: revision.content,
      },
      update: {
        baseContentHash,
        content: revision.content,
      },
      select: { id: true },
    });

    await prisma.systemPromptOverrideRevision.create({
      data: {
        systemPromptOverrideId: override.id,
        promptKey: revision.promptKey,
        role: revision.role,
        index: revision.index,
        baseContentHash,
        content: revision.content,
        action: "ROLLBACK",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to rollback system prompt" };
  }
}

export type SystemSnippetOverrideRecord = {
  id: string;
  snippetKey: string;
  content: string;
  updatedAt: string;
};

export type SystemSnippetOverrideRevisionRecord = {
  id: string;
  snippetKey: string;
  content: string | null;
  action: string;
  createdAt: Date;
  createdByEmail: string | null;
};

export async function getSystemSnippetOverrides(): Promise<{ success: boolean; data?: SystemSnippetOverrideRecord[]; error?: string }> {
  try {
    await requireSuperAdminUser();

    const rows = await prisma.systemPromptSnippetOverride.findMany({
      orderBy: [{ snippetKey: "asc" }],
      select: { id: true, snippetKey: true, content: true, updatedAt: true },
    });

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        snippetKey: r.snippetKey,
        content: r.content,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load system snippet overrides" };
  }
}

export async function saveSystemSnippetOverride(params: {
  snippetKey: string;
  content: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireSuperAdminUser();

    const codeDefaultSnapshot = SNIPPET_DEFAULTS[params.snippetKey];
    if (typeof codeDefaultSnapshot !== "string") {
      return { success: false, error: `Unknown snippet key: ${params.snippetKey}` };
    }

    const saved = await prisma.systemPromptSnippetOverride.upsert({
      where: { snippetKey: params.snippetKey },
      create: { snippetKey: params.snippetKey, content: params.content, codeDefaultSnapshot },
      update: { content: params.content, codeDefaultSnapshot },
      select: { id: true },
    });

    await prisma.systemPromptSnippetOverrideRevision.create({
      data: {
        systemPromptSnippetOverrideId: saved.id,
        snippetKey: params.snippetKey,
        content: params.content,
        action: "UPSERT",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[saveSystemSnippetOverride] Error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to save system snippet override" };
  }
}

export async function resetSystemSnippetOverride(params: {
  snippetKey: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireSuperAdminUser();

    const existing = await prisma.systemPromptSnippetOverride.findFirst({
      where: { snippetKey: params.snippetKey },
      select: { id: true, content: true },
    });

    await prisma.systemPromptSnippetOverride.deleteMany({
      where: { snippetKey: params.snippetKey },
    });

    if (existing) {
      await prisma.systemPromptSnippetOverrideRevision.create({
        data: {
          systemPromptSnippetOverrideId: existing.id,
          snippetKey: params.snippetKey,
          content: existing.content,
          action: "RESET",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("[resetSystemSnippetOverride] Error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to reset system snippet override" };
  }
}

export async function getSystemSnippetOverrideRevisions(params: {
  snippetKey: string;
}): Promise<{ success: boolean; data?: SystemSnippetOverrideRevisionRecord[]; error?: string }> {
  try {
    await requireSuperAdminUser();

    const revisions = await prisma.systemPromptSnippetOverrideRevision.findMany({
      where: { snippetKey: params.snippetKey },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        snippetKey: true,
        content: true,
        action: true,
        createdAt: true,
        createdByEmail: true,
      },
    });

    return { success: true, data: revisions };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load system snippet history" };
  }
}

export async function rollbackSystemSnippetOverrideRevision(params: {
  revisionId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId, userEmail } = await requireSuperAdminUser();

    const revision = await prisma.systemPromptSnippetOverrideRevision.findFirst({
      where: { id: params.revisionId },
      select: { snippetKey: true, content: true },
    });
    if (!revision) return { success: false, error: "Revision not found" };

    if (!revision.content) {
      await prisma.systemPromptSnippetOverride.deleteMany({
        where: { snippetKey: revision.snippetKey },
      });
      await prisma.systemPromptSnippetOverrideRevision.create({
        data: {
          snippetKey: revision.snippetKey,
          content: null,
          action: "ROLLBACK_DELETE",
          createdByUserId: userId,
          createdByEmail: userEmail ?? null,
        },
      });
      return { success: true };
    }

    const codeDefaultSnapshot = SNIPPET_DEFAULTS[revision.snippetKey] ?? null;

    const override = await prisma.systemPromptSnippetOverride.upsert({
      where: { snippetKey: revision.snippetKey },
      create: {
        snippetKey: revision.snippetKey,
        content: revision.content,
        ...(codeDefaultSnapshot ? { codeDefaultSnapshot } : {}),
      },
      update: {
        content: revision.content,
        ...(codeDefaultSnapshot ? { codeDefaultSnapshot } : {}),
      },
      select: { id: true },
    });

    await prisma.systemPromptSnippetOverrideRevision.create({
      data: {
        systemPromptSnippetOverrideId: override.id,
        snippetKey: revision.snippetKey,
        content: revision.content,
        action: "ROLLBACK",
        createdByUserId: userId,
        createdByEmail: userEmail ?? null,
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to rollback system snippet override" };
  }
}

