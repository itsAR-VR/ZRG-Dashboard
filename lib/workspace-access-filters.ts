import "server-only";

import type { Prisma } from "@prisma/client";

export function accessibleClientWhere(userId: string): Prisma.ClientWhereInput {
  return {
    OR: [{ userId }, { members: { some: { userId } } }],
  };
}

export function accessibleLeadWhere(userId: string): Prisma.LeadWhereInput {
  return { client: accessibleClientWhere(userId) };
}

