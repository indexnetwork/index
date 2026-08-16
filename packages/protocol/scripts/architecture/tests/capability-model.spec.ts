import { describe, expect, test } from "bun:test";

import { capabilityForSourcePath, facadeCapabilityForSourcePath, implementationCapabilityForSourcePath } from "../capability-model.ts";

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

  test("recognizes capability facades and leaves neutral shared code unclassified", () => {
    expect(facadeCapabilityForSourcePath("capabilities/opportunities.facade.ts")).toBe("opportunities");
    expect(facadeCapabilityForSourcePath("capabilities/negotiation.discovery.facade.ts")).toBe("negotiation");
    expect(implementationCapabilityForSourcePath("shared/hyde/hyde.graph.ts")).toBeUndefined();
  });
});
