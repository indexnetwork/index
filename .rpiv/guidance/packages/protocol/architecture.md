# Protocol Package

## Responsibility
Adapter-free protocol layer: LangGraph workflows, structured LLM agents, MCP/chat tools, schemas, and TypeScript interfaces. Host applications inject infrastructure through constructor/interface deps.

## Dependencies
- **LangGraph**: graph state, nodes, edges, compiled workflows.
- **LangChain/OpenRouter model config**: structured LLM invocation.
- **Zod**: runtime schemas for tools and agent outputs.
- **Shared interfaces**: DB/cache/embedder/dispatcher ports.

## Consumers
- **Backend**: imports factories/tools/interfaces and injects adapters.
- **CLI/plugin/web/native apps indirectly**: consume protocol behavior through API/MCP surfaces.

## Module Structure
```
packages/protocol/
├── src/index.ts                  # public package barrel
├── src/shared/                   # interfaces, tools, model config, schemas
├── src/chat/, intent/            # chat and intent workflows
├── src/opportunity/, negotiation/# discovery and negotiation domains
├── src/questioner/, hyde/, etc.  # supporting protocol domains
└── skills/                       # Claude plugin skill templates/partials
```

## Adapter-Free Factory Pattern
```ts
export interface FeatureDatabase {
  getFeature(id: string): Promise<Feature | null>;
  createFeature(input: CreateFeature): Promise<Feature>;
}

export class FeatureGraphFactory {
  constructor(private readonly database: FeatureDatabase, private readonly embedder: Embedder) {}

  createGraph() {
    return new StateGraph(FeatureState)
      .addNode('load', async (state) => ({ feature: await this.database.getFeature(state.id) }))
      .compile();
  }
}
```

## Tool Factory Pattern
```ts
export function createFeatureTools(defineTool: DefineTool, deps: ToolDeps) {
  return [defineTool({
    name: 'read_features',
    querySchema: z.object({ id: z.string().optional() }),
    handler: async ({ context, query }) => {
      const result = await deps.database.getFeature(query.id ?? context.userId);
      return result ? success({ feature: result }) : error('Feature not found');
    },
  })];
}
```

## Boundary Rules
- Never import API-service adapters, controllers, services, Drizzle schema, or app code.
- Ports return plain values/null/arrays or throw for invariants; not HTTP responses.
- User-facing LLM output must be schema-validated and sanitized where IDs/internal data could leak.

<important if="you are adding protocol capability">
1. Define narrow interfaces/types in the owning module or `shared/interfaces`.
2. Implement graph/agent/tool with injected deps and Zod schemas.
3. Export the public surface from `src/index.ts` only when host packages need it.
4. Implement API-service adapter/wiring separately.
5. Add protocol unit tests with stubbed deps/models.
</important>
