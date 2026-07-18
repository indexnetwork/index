import { describe, expect, it } from 'bun:test';

import { OpportunityGraphFactory } from '../../../opportunity/opportunity.graph.js';
import type { StampNewbornOpportunitiesFn } from '../../../opportunity/opportunity.graph.js';
import { createChatTools } from '../tool.factory.js';
import type { ToolContext } from '../tool.helpers.js';

describe('createChatTools newborn callback propagation', () => {
  it('passes the host stamper to the synchronous opportunity graph', async () => {
    const stampNewbornOpportunities: StampNewbornOpportunitiesFn = async ({ items }) => items;
    const prototype = OpportunityGraphFactory.prototype as unknown as {
      createGraph: (this: OpportunityGraphFactory) => ReturnType<OpportunityGraphFactory['createGraph']>;
    };
    const originalCreateGraph = prototype.createGraph;
    let captured: StampNewbornOpportunitiesFn | undefined;
    prototype.createGraph = function (this: OpportunityGraphFactory) {
      captured = (this as unknown as { stampNewbornOpportunities?: StampNewbornOpportunitiesFn }).stampNewbornOpportunities;
      return originalCreateGraph.call(this);
    };

    try {
      const context = {
        userId: 'user-1',
        database: {
          getUser: async () => ({ id: 'user-1', name: 'User', email: 'user@example.com' }),
          getProfile: async () => null,
          getNetworkMemberships: async () => [],
          getUserContext: async () => null,
        },
        embedder: {},
        scraper: {},
        cache: {},
        hydeCache: {},
        integration: {},
        intentQueue: {},
        contactService: {},
        enricher: {},
        negotiationDatabase: {},
        integrationImporter: {},
        createUserDatabase: () => ({}),
        createSystemDatabase: () => ({}),
        stampNewbornOpportunities,
      } as unknown as ToolContext;

      await createChatTools(context);
      expect(captured).toBe(stampNewbornOpportunities);
    } finally {
      prototype.createGraph = originalCreateGraph;
    }
  });
});
