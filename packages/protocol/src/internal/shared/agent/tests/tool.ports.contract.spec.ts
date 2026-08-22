import { expect, test } from "bun:test";
import type { EnrichmentToolDeps } from "../../../contexts/context.tools.port.js";
import type { NetworkToolDeps } from "../../../../capabilities/networks.js";
import type { OpportunityToolDeps } from "../../../opportunities/opportunity.tools.port.js";
import type { ToolDeps } from "../tool.helpers.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

// These compile-time assertions protect the narrow ports consumed by tool composition.
type _EnrichmentPortIsExact = Expect<Equal<keyof EnrichmentToolDeps,
  | "userDb" | "systemDb" | "graphs" | "enricher"
  | "grantDefaultSystemPermissions" | "reportToolError" | "getUserContextText"
  | "enrichmentRuns" | "enrichmentRunQueue"
>>;
type _NetworkPortIsExact = Expect<Equal<keyof NetworkToolDeps,
  | "graphs" | "userDb" | "systemDb" | "getUserContextText"
  | "networkRanker" | "reportToolError"
>>;
type _OpportunityPortIsExact = Expect<Equal<keyof OpportunityToolDeps,
  | "database" | "userDb" | "systemDb" | "graphs" | "cache" | "chatSummary"
  | "opportunityDiscovery" | "opportunityPresentation"
  | "questionerEnqueue" | "findPendingQuestions" | "negotiationSummary"
  | "negotiationDatabase" | "deliveryLedger"
  | "frontendUrl" | "stampNewbornOpportunities" | "reportToolError"
>>;
type _EnrichmentGraphsAreExact = Expect<Equal<keyof EnrichmentToolDeps["graphs"], "profile">>;
type _OpportunityGraphsAreExact = Expect<Equal<keyof OpportunityToolDeps["graphs"], "index" | "networkMembership" | "opportunity">>;

test("ToolDeps remains structurally compatible with each narrow tool port", () => {
  const compatibility: ToolDeps = {} as ToolDeps;
  const enrichment: EnrichmentToolDeps = compatibility;
  const network: NetworkToolDeps = compatibility;
  const opportunity: OpportunityToolDeps = compatibility;

  expect([enrichment, network, opportunity]).toHaveLength(3);
});
