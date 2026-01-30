# Phase 71b — Rename Default Sequence + Migrate Existing Sequences

## Focus

Rename the default "Meeting Requested" sequence to "ZRG Workflow V1" in code and migrate existing sequences for ZRG workspaces (excluding Founders Club).

## Inputs

- Phase 71a complete (pause/resume bug fixed)
- Workspace identification logic: `brandName IS NULL` = ZRG, `brandName = "Founders Club"` = skip

## Work

### Step 1: Update Default Sequence Constant

**File:** `actions/followup-sequence-actions.ts`

Change line 794:
```typescript
// From
meetingRequested: "Meeting Requested Day 1/2/5/7",

// To
meetingRequested: "ZRG Workflow V1",
```

### Step 2: Create Migration Script

**File:** `scripts/phase-71-rename-workflow.ts`

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OLD_NAME = "Meeting Requested Day 1/2/5/7";
const NEW_NAME = "ZRG Workflow V1";

async function main() {
  console.log("Phase 71: Renaming workflows for ZRG workspaces...\n");

  // Find all sequences to rename (ZRG workspaces only - brandName IS NULL)
  const sequencesToRename = await prisma.followUpSequence.findMany({
    where: {
      name: OLD_NAME,
      client: {
        settings: {
          brandName: null,  // ZRG workspaces only
        },
      },
    },
    include: {
      client: {
        select: {
          name: true,
          settings: { select: { brandName: true } },
        },
      },
    },
  });

  console.log(`Found ${sequencesToRename.length} sequences to rename:\n`);

  for (const seq of sequencesToRename) {
    console.log(`  - ${seq.client.name} (${seq.id})`);
  }

  if (sequencesToRename.length === 0) {
    console.log("No sequences found to rename. Exiting.");
    return;
  }

  // Check for Founders Club sequences (should NOT be renamed)
  const foundersClubSequences = await prisma.followUpSequence.findMany({
    where: {
      name: OLD_NAME,
      client: {
        settings: {
          brandName: { not: null },
        },
      },
    },
    include: {
      client: {
        select: {
          name: true,
          settings: { select: { brandName: true } },
        },
      },
    },
  });

  if (foundersClubSequences.length > 0) {
    console.log(`\nSkipping ${foundersClubSequences.length} Founders Club sequences:`);
    for (const seq of foundersClubSequences) {
      console.log(`  - ${seq.client.name} (brandName: ${seq.client.settings?.brandName})`);
    }
  }

  // Perform the rename
  console.log(`\nRenaming ${sequencesToRename.length} sequences...`);

  const result = await prisma.followUpSequence.updateMany({
    where: {
      id: { in: sequencesToRename.map((s) => s.id) },
    },
    data: {
      name: NEW_NAME,
      description:
        "Triggered when setter sends first email reply: Day 1 (SMS), Day 2 (Email + SMS), Day 5 (reminder), Day 7 (final check-in)",
    },
  });

  console.log(`\n✅ Successfully renamed ${result.count} sequences to "${NEW_NAME}"`);

  // Verify Founders Club unchanged
  const fcVerify = await prisma.followUpSequence.findMany({
    where: {
      name: OLD_NAME,
      client: {
        settings: {
          brandName: { not: null },
        },
      },
    },
  });

  console.log(`\n✅ Founders Club verification: ${fcVerify.length} sequences still named "${OLD_NAME}"`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

### Step 3: Run Migration

```bash
npx tsx scripts/phase-71-rename-workflow.ts
```

### Step 4: Verify

1. Check ZRG workspaces have "ZRG Workflow V1" sequence
2. Check Founders Club still has "Meeting Requested Day 1/2/5/7"
3. Run `npm run lint && npm run build`

## Output

- `actions/followup-sequence-actions.ts` updated with new default name
- `scripts/phase-71-rename-workflow.ts` created and executed
- All ZRG workspace sequences renamed
- Founders Club sequences unchanged

## Handoff

Phase 71 complete. New workspaces will use "ZRG Workflow V1" as default, existing ZRG workspaces migrated.
