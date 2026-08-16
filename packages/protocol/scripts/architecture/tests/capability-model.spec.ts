import { describe, expect, test } from "bun:test";

import { barrelCapabilityForSourcePath, capabilityForSourcePath, implementationCapabilityForSourcePath } from "../capability-model.ts";

describe("protocol capability model", () => {
  test("normalizes canonical and compatibility directories", () => {
    expect(capabilityForSourcePath("signals/application/intent.graph.ts")).toBe("signals");
    expect(capabilityForSourcePath("intent/intent.graph.ts")).toBe("signals");
    expect(capabilityForSourcePath("participant-context/domain/index.ts")).toBe("participant-context");
    expect(capabilityForSourcePath("enrichment/enrichment.graph.ts")).toBe("participant-context");
    expect(capabilityForSourcePath("communities/application/network.graph.ts")).toBe("communities");
    expect(capabilityForSourcePath("network/network.graph.ts")).toBe("communities");
    expect(capabilityForSourcePath("participant-agents/application/agent.tools.ts")).toBe("participant-agents");
    expect(capabilityForSourcePath("chat/chat.graph.ts")).toBe("participant-agents");
  });

  test("classifies the tool composition root as interaction-composition", () => {
    expect(capabilityForSourcePath("shared/agent/tool.registry.ts")).toBe("interaction-composition");
    expect(capabilityForSourcePath("shared/agent/tool.factory.ts")).toBe("interaction-composition");
    expect(capabilityForSourcePath("maintenance/maintenance.graph.ts")).toBe("interaction-composition");
  });

  test("recognizes capability barrels and leaves neutral shared code unclassified", () => {
    expect(barrelCapabilityForSourcePath("opportunity/index.ts")).toBe("opportunities");
    expect(barrelCapabilityForSourcePath("negotiation/index.ts")).toBe("negotiation");
    expect(barrelCapabilityForSourcePath("negotiation/application/index.ts")).toBeUndefined();
    expect(implementationCapabilityForSourcePath("shared/hyde/hyde.graph.ts")).toBeUndefined();
  });
});
