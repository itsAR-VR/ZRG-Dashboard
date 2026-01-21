# Phase 47a — Prisma Schema: PromptOverride Model

## Focus

Add a database model to store workspace-level prompt overrides, allowing each workspace to customize AI prompt content without modifying code.

## Inputs

- Root plan design decision for `PromptOverride` model
- Existing `Client` model for workspace relation
- Understanding of prompt structure (`key`, `role`, `content`)

## Work

1. **Add PromptOverride model to `prisma/schema.prisma`:**

```prisma
model PromptOverride {
  id        String   @id @default(uuid())
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  promptKey String   // e.g., "sentiment.classify.v1"
  role      String   // "system", "assistant", or "user"
  index     Int      // Message index within the role group (0-based)
  content   String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([clientId, promptKey, role, index])
  @@index([clientId])
}
```

2. **Add relation to Client model:**

```prisma
model Client {
  // ... existing fields ...
  promptOverrides   PromptOverride[]
}
```

3. **Run schema push:**

```bash
npm run db:push
```

4. **Verify in Prisma Studio:**

```bash
npm run db:studio
```

## Output

- `PromptOverride` model added to schema
- Database updated with new table
- Prisma client regenerated with new types

## Handoff

Subphase b will use the `PromptOverride` model to implement override lookup in the prompt registry.
