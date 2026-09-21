import { defineTool, type Tool } from "../shared/reasoning/reasoning.tool.js";

const SEARCH_QUERIES = 5;
const OPEN_LIMIT = 30;

/** Discovery/open operations; conversation publication and turn submission stay with the runner. */
export interface PrincipalOperations {
  /**
   * @param intentId - The principal's intent to discover from.
   * @param query - What to look for in a counterparty.
   * @param limit - Maximum number of counterparties to return, from 1 to 30.
   * @returns Ranked counterparties, strongest first; an empty result is valid.
   * @throws If discovery fails or access is denied.
   */
  findCounterparties(intentId: string, query: string, limit: number): Promise<Counterparty[]>;

  /**
   * @param intentId - The principal's intent the opportunities belong to.
   * @param picks - Counterparty intents and the network for each pairing.
   * @returns The host-authoritative IDs of opportunities that now exist.
   * @throws If opportunity creation fails or access is denied.
   */
  createOpportunities(intentId: string, picks: CounterpartyPick[]): Promise<{ opportunityId: string }[]>;
}

export interface Counterparty {
  intentId: string;
  userId: string;
  name: string;
  statement: string;
  networkId: string;
  score: number;
}

export interface CounterpartyPick {
  intentId: string;
  networkId: string;
}

export function createDiscoveryTool(input: {
  intentId: string;
  operations: PrincipalOperations;
  onProgress?: (text: string) => void | Promise<void>;
  onOpened?: (opportunityIds: string[]) => void;
}): Tool {
  return defineTool({
    name: "reach_counterparties",
    description: "Discover people in this intent's communities and open an opportunity with everyone discovered. A query describes the kind of person this intent needs, in your own words, not the intent restated. Give several queries at once when one kind of person is not the whole answer; each direction is discovered separately and the results are merged. Everyone discovered is opened and briefed for you. Describe this to the principal as discovering people and reaching out, never as searching.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        queries: { type: "array", minItems: 1, maxItems: SEARCH_QUERIES, items: { type: "string", minLength: 1 } },
      },
      required: ["queries"],
    },
    run: async ({ queries }: { queries: string[] }) => {
      const results = await Promise.all(queries.map((query) => input.operations.findCounterparties(input.intentId, query, OPEN_LIMIT)));
      const found = new Map<string, Counterparty>();
      for (const counterparty of results.flat()) {
        const seen = found.get(counterparty.userId);
        if (!seen || counterparty.score > seen.score) found.set(counterparty.userId, counterparty);
      }
      const picks = [...found.values()]
        .sort((left, right) => right.score - left.score)
        .slice(0, OPEN_LIMIT)
        .map(({ intentId, networkId }) => ({ intentId, networkId }));
      if (!picks.length) return "No counterparties matched those queries. Try different ones, or stop.";
      const created = await input.operations.createOpportunities(input.intentId, picks);
      await input.onProgress?.(`Discovered ${found.size} people and reached out to ${created.length}.`);
      input.onOpened?.(created.map(({ opportunityId }) => opportunityId));
      return `Reached ${created.length} of ${picks.length} found, and each one is being briefed and proposed to now. The rest were already opportunities or are no longer reachable.`;
    },
  });
}
