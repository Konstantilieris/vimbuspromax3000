import { createPrismaClient } from "../src/client";

type VerificationItemForBackfill = {
  id: string;
  taskId: string;
  kind: string;
  runner: string | null;
  title: string;
  description: string;
  rationale: string | null;
  command: string | null;
  testFilePath: string | null;
  status: string;
  orderIndex: number;
  configJson: string | null;
  plan: {
    task: {
      acceptanceJson: string;
    };
  };
};

const prisma = createPrismaClient();

try {
  const result = await backfillValidations();
  console.log(
    `Backfilled validations: created=${result.created}, skipped=${result.skipped}, inspected=${result.inspected}`,
  );
} finally {
  await prisma.$disconnect();
}

async function backfillValidations() {
  const items = await prisma.verificationItem.findMany({
    include: {
      plan: {
        select: {
          task: {
            select: {
              acceptanceJson: true,
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });
  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const existing = await prisma.validation.findFirst({
      where: {
        OR: [{ legacyVerificationItemId: item.id }, { verificationItemId: item.id }],
      },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.validation.create({ data: toValidationCreateData(item) });
    created += 1;
  }

  return {
    inspected: items.length,
    created,
    skipped,
  };
}

function toValidationCreateData(item: VerificationItemForBackfill) {
  return {
    taskId: item.taskId,
    verificationItemId: item.id,
    legacyVerificationItemId: item.id,
    testType: mapVerificationKindToTestType(item),
    status: mapVerificationStatus(item.status),
    title: item.title,
    description: item.description,
    acceptanceCriteriaJson: item.plan.task.acceptanceJson || "[]",
    rationale: item.rationale,
    command: item.command,
    testFilePath: item.testFilePath,
    metadataJson: item.configJson,
    orderIndex: item.orderIndex,
  };
}

function mapVerificationKindToTestType(item: VerificationItemForBackfill) {
  if (item.runner === "playwright") {
    return "playwright";
  }

  return item.kind;
}

function mapVerificationStatus(status: string) {
  switch (status) {
    case "approved":
      return "approved";
    case "green":
    case "passed":
      return "passed";
    case "red":
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "rejected":
      return "rejected";
    default:
      return "proposed";
  }
}
