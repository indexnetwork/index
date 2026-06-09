# Protocol Opportunity

## Responsibility
Connection-opportunity domain: discovers candidates, evaluates matches, persists/enriches opportunities, presents cards/feed sections, exposes tools, and hands accepted candidates into negotiation.

## Dependencies
- **LangGraph**: `OpportunityGraphFactory` and home/feed graph workflows.
- **Structured LLM agents**: evaluator, presenter, categorizer, question generator.
- **Injected database/cache/embedder/queue interfaces**: adapter-free persistence and async boundaries.
- **Zod tools**: MCP/chat tool validation and success/error envelopes.

## Consumers
- **Backend opportunity services/queues/MCP**: instantiate graphs/tools.
- **Negotiation/questioner/maintenance**: consume opportunity outputs and helper contracts.

## Module Structure
```
opportunity/
├── opportunity.state.ts, opportunity.graph.ts   # main discovery lifecycle
├── opportunity.tools.ts                         # discover/list/update/poll tools
├── evaluator/presenter/persist/utils files      # LLM, persistence, pure helpers
├── feed/                                        # home feed projection graph
└── tests/                                       # graph/tool/feed/presenter specs
```

## Graph Factory + Scope Pattern
```ts
export class OpportunityGraphFactory {
  constructor(private readonly deps: OpportunityDeps) {}

  createGraph() {
    return new StateGraph(OpportunityGraphState)
      .addNode('scope', async (s) => {
        const memberships = await this.deps.database.getNetworkMemberships(s.userId);
        const allowed = intersectScope(s.indexScope, memberships.map(m => m.networkId));
        return allowed.length ? { indexScope: allowed } : { error: 'No accessible indexes' };
      })
      .addNode('discover', discoverNode)
      .addNode('persist', persistNode)
      .compile();
  }
}
```

## Visibility/Actionability Matrix
```ts
export function canUserSeeOpportunity(actors: Actor[], status: OpportunityStatus, viewerId: string) {
  const roles = actors.filter(a => a.userId === viewerId).map(a => a.role);
  if (roles.length === 0) return false;
  return roles.some(role => role === 'introducer' || role === 'peer' || status !== 'latent');
}

export function isActionableForViewer(opp: Opportunity, viewerId: string) {
  return canUserSeeOpportunity(opp.actors, opp.status, viewerId) && !['expired', 'rejected'].includes(opp.status);
}
```

## Tool + Coalescing Pattern
```ts
const discover = defineTool({
  name: 'discover_opportunities',
  querySchema: DiscoverSchema,
  handler: async ({ context, query }) => {
    if (context.networkId && query.networkId !== context.networkId) return error('Scope denied');
    const active = await deps.discoveryRuns.findEquivalent(context.userId, stableSignature(query));
    if (active) return success({ discoveryRunId: active.id, coalesced: true });
    return success(await runDiscoverFromQuery({ graph: deps.graphs.opportunity, userId: context.userId, query }));
  },
});
```

## Boundary Rules
- Scope/membership intersection must happen before discovery searches.
- User-facing card text goes through presenter/fallback and ID sanitizers.
- Status changes require updating visibility/actionability, feed filters, mutation guards, and cache keys.

<important if="you are adding opportunity status or action">
1. Update status schemas/types and default filters.
2. Update `canUserSeeOpportunity`, `isActionableForViewer`, labels, and blocked mutation statuses.
3. Update presenter/feed behavior and cache key/skipping rules.
4. Add tests for visibility, list/home inclusion, mutation, and card rendering.
</important>
