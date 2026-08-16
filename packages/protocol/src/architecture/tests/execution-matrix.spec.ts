import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type ExecutionMatrixRow = {
  useCase: "signals" | "opportunities" | "negotiation";
  foreground: { entry: string; source: string; transport: string };
  ambient: { entry: string; source: string; transport: string };
  sharedFactory: string;
  invariant: string;
};

const matrix: ExecutionMatrixRow[] = [
  {
    useCase: "signals",
    foreground: { entry: "createIntentTools", source: "signals/application/intent.tools.ts", transport: "participant tool" },
    ambient: { entry: "IntentGraphFactory", source: "signals/application/intent.graph.ts", transport: "injected queue callback" },
    sharedFactory: "IntentGraphFactory",
    invariant: "admission, verification, reconciliation, lifecycle, and repository ports are shared",
  },
  {
    useCase: "opportunities",
    // IND-551: canonical paths moved to application/ layer; shims remain at flat paths.
    foreground: { entry: "createOpportunityTools", source: "opportunity/application/opportunity.tools.ts", transport: "participant tool" },
    ambient: { entry: "OpportunityGraphFactory", source: "opportunity/application/opportunity.graph.ts", transport: "injected queue callback" },
    sharedFactory: "OpportunityGraphFactory",
    invariant: "candidate evaluation, deduplication, lifecycle, visibility, and safe presentation are shared",
  },
  {
    useCase: "negotiation",
    foreground: { entry: "createNegotiationTools", source: "negotiation/application/negotiation.tools.ts", transport: "participant tool" },
    ambient: { entry: "NegotiationGraphFactory", source: "negotiation/application/negotiation.graph.ts", transport: "injected dispatcher and timeout queue" },
    sharedFactory: "NegotiationGraphFactory",
    invariant: "turn schema, seat rules, deadlock policy, finalization, and message/task ports are shared",
  },
];

const sourceRoot = resolve(import.meta.dir, "../..");

describe("foreground and ambient execution matrix", () => {
  test("keeps representative use cases on shared factories with explicit transport differences", async () => {
    expect(matrix).toHaveLength(3);
    for (const row of matrix) {
      expect(row.foreground.transport).not.toBe(row.ambient.transport);
      expect(row.invariant).toContain("shared");
      const [foregroundSource, ambientSource] = await Promise.all([
        readFile(resolve(sourceRoot, row.foreground.source), "utf8"),
        readFile(resolve(sourceRoot, row.ambient.source), "utf8"),
      ]);
      expect(foregroundSource).toContain(`function ${row.foreground.entry}`);
      expect(ambientSource).toContain(`class ${row.sharedFactory}`);
    }
  });

  test("keeps foreground composition on injected protocol factories rather than host adapters", async () => {
    const toolFactory = await readFile(resolve(sourceRoot, "shared/agent/tool.factory.ts"), "utf8");
    for (const row of matrix) expect(toolFactory).toContain(`new ${row.sharedFactory}`);
    expect(toolFactory).not.toMatch(/services\/api|apps\/web|drizzle-orm|bullmq/);
  });
});
