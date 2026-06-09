# Protocol Shared Interfaces

## Responsibility
Port/contract layer for host-provided persistence, cache, embedder, dispatcher, tool deps, and protocol data shapes. Backend implements these structurally.

## Dependencies
- **TypeScript interfaces/types**: compile-time contracts.
- **Protocol DTOs**: shared data shapes used by graphs/tools.

## Consumers
- **Protocol factories/tools**: depend on these contracts.
- **Backend adapters**: implement matching methods without importing implementation code.

## Module Structure
```
interfaces/
├── database.interface.ts        # graph/tool persistence contracts and DTOs
├── cache/embedder/etc.          # infrastructure ports
├── agent-dispatcher.interface.ts# personal-agent transport boundary
└── tool-related contracts       # ToolDeps and call context shapes
```

## Narrow Port Pattern
```ts
export interface OpportunityReader {
  getOpportunity(id: string): Promise<Opportunity | null>;
  getOpportunitiesForUser(userId: string, opts?: OpportunityFilter): Promise<Opportunity[]>;
}

export interface OpportunityWriter {
  createOpportunity(input: CreateOpportunity): Promise<Opportunity>;
  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<Opportunity | null>;
}
```

## Backend Structural Implementation
```ts
class DatabaseAdapter implements OpportunityReader, OpportunityWriter {
  async getOpportunity(id: string): Promise<Opportunity | null> { /* Drizzle mapping */ }
  async createOpportunity(input: CreateOpportunity): Promise<Opportunity> { /* insert */ }
  async updateOpportunityStatus(id: string, status: OpportunityStatus) { /* update */ }
}
```

## Boundary Rules
- Interfaces should be narrow enough for tests to stub easily.
- Return plain domain values, null, arrays, booleans, or throw; never HTTP `Response`.
- Do not import backend schema/adapters in this folder.

<important if="you are extending protocol interfaces">
1. Add the smallest method/type needed by the graph/tool.
2. Update backend adapter implementation in a separate backend change.
3. Update test stubs wherever the interface is consumed.
4. Prefer local `Pick<>`-style interfaces in domain modules for one-off needs.
</important>
