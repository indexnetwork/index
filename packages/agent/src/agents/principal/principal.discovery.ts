import { defineTool, type Tool } from "../shared/reasoning/reasoning.tool.js";

const SEARCH_QUERIES = 5;
const OPEN_LIMIT = 30;

/** Search/open operations; conversation publication and turn submission stay with the runner. */
export interface PrincipalOperations {
  /**
   * @param intentId - The principal's intent to search from.
   * @param query - What to look for in a counterparty.
   * @param limit - Maximum number of counterparties to return, from 1 to 30.
   * @returns Ranked counterparties, strongest first; an empty result is valid.
   * @throws If the search fails or access is denied.
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
  onOpened?: (opportunityIds: string[]) => void;
}): Tool {
  return defineTool({
    name: "reach_counterparties",
    description: "Search this intent's communities and open an opportunity with everyone the search finds. A query is the kind of person this intent needs, in your own words, not the intent restated. Give several queries at once when one kind of person is not the whole answer — each is searched separately and the results are merged, so different angles reach people a single query cannot. Everyone found is opened and briefed for you: your judgement belongs in the queries, not in narrowing what they return, because opening explores a pair rather than committing your principal to it and only the negotiator can establish whether one is worth anything. Anyone this intent is already working is left out, and nothing you search for is shown to anyone.",
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
      input.onOpened?.(created.map(({ opportunityId }) => opportunityId));
      return `Reached ${created.length} of ${picks.length} found, and each one is being briefed and proposed to now. The rest were already opportunities or are no longer reachable.`;
    },
  });
}
