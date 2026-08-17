import { describe, expect, test } from "bun:test";

import { barrelCapabilityForSourcePath, capabilityForSourcePath, implementationCapabilityForSourcePath } from "../capability-model.ts";

describe("protocol capability model", () => {
  test("normalizes canonical and compatibility directories", () => {
    expect(capabilityForSourcePath("intents/graph/intent.graph.ts")).toBe("intents");
    expect(capabilityForSourcePath("intents/intake/intake.orchestrator.ts")).toBe("intents");
    expect(capabilityForSourcePath("contexts/domain/index.ts")).toBe("contexts");
    expect(capabilityForSourcePath("enrichment/enrichment.graph.ts")).toBe("contexts");
    expect(capabilityForSourcePath("networks/application/network.graph.ts")).toBe("networks");
    expect(capabilityForSourcePath("networks/application/network.graph.ts")).toBe("networks");
    expect(capabilityForSourcePath("agents/application/agent.tools.ts")).toBe("agents");
    expect(capabilityForSourcePath("chat/chat.graph.ts")).toBe("agents");
  });

  test("classifies the tool composition root as interaction-composition", () => {
    expect(capabilityForSourcePath("shared/agent/tool.registry.ts")).toBe("interaction-composition");
    expect(capabilityForSourcePath("shared/agent/tool.factory.ts")).toBe("interaction-composition");
    expect(capabilityForSourcePath("maintenance/maintenance.graph.ts")).toBe("interaction-composition");
  });

  test("recognizes capability barrels and leaves neutral shared code unclassified", () => {
    expect(barrelCapabilityForSourcePath("opportunities/index.ts")).toBe("opportunities");
    expect(barrelCapabilityForSourcePath("negotiations/index.ts")).toBe("negotiations");
    expect(barrelCapabilityForSourcePath("negotiations/application/index.ts")).toBeUndefined();
    // intents states its surface as a class, so its barrel is intent.module.ts.
    expect(barrelCapabilityForSourcePath("intents/intent.module.ts")).toBe("intents");
    expect(barrelCapabilityForSourcePath("intents/index.ts")).toBeUndefined();
    expect(barrelCapabilityForSourcePath("intents/graph/intent.graph.ts")).toBeUndefined();
    // HyDE used to live in shared/ and was unclassified; it is a capability now.
    expect(barrelCapabilityForSourcePath("discovery/index.ts")).toBe("discovery");
    expect(implementationCapabilityForSourcePath("discovery/hyde.graph.ts")).toBe("discovery");
    // What remains under shared/ is genuinely neutral and stays unclassified.
    expect(implementationCapabilityForSourcePath("shared/observability/log.ts")).toBeUndefined();
    expect(implementationCapabilityForSourcePath("shared/interfaces/cache.interface.ts")).toBeUndefined();
  });
});
