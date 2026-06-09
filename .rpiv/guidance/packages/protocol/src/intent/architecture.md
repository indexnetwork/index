# Protocol Intent

## Responsibility
Intent/signal agent domain. It infers, verifies, reconciles, indexes, and executes intent operations through LangGraph workflows and structured LLM agents.

## Dependencies
- **LangGraph**: stateful workflow nodes and routing.
- **Zod + structured LLM output**: inference/verification/reconciliation contracts.
- **Shared database/embedder/HyDE interfaces**: injected persistence and semantic search.

## Consumers
- **Backend intent queues/tools/services**: run HyDE/indexing and CRUD tool flows.
- **Opportunity discovery**: uses intent/index fit and embeddings.

## Module Structure
```
intent/
├── intent.state.ts       # graph state and operation contracts
├── intent.graph.ts       # prep/query/infer/verify/reconcile/execute workflow
├── *.agent.ts            # structured LLM sub-agents
├── *.tools.ts            # MCP/chat tool surface where present
└── tests/                # graph and agent unit specs
```

## Structured Agent Pattern
```ts
const OutputSchema = z.object({
  description: z.string(),
  confidence: z.number().min(0).max(1),
  inferenceType: z.enum(['explicit', 'implicit']),
});

export class IntentInferrer {
  private readonly model = createModel('intentInferrer').withStructuredOutput(OutputSchema, {
    name: 'intent_inference',
  });

  async invoke(input: InferIntentInput) {
    const raw = await invokeWithAbortSignal(this.model, renderMessages(input));
    return OutputSchema.parse(raw);
  }
}
```

## Graph Node Pattern
```ts
const inferNode = async (state: IntentGraphState) => {
  if (!state.query) return { error: 'Missing intent query' };
  const inferred = await inferrer.invoke({ query: state.query, profile: state.profile });
  return { inferredIntent: inferred, trace: [...state.trace, 'inferred'] };
};
```

## Boundary Rules
- Keep DB/embedder access behind injected interfaces.
- Use Zod schemas as the public LLM output contract.
- Regenerate HyDE/indexing asynchronously; do not block HTTP flows with heavy work unless explicitly required.

<important if="you are adding intent graph behavior">
1. Add state fields with reducers/defaults.
2. Add a focused node or structured agent.
3. Validate LLM outputs with Zod and decide fallback/null/throw policy.
4. Wire backend queue/tool invocation separately.
5. Add graph tests with stubbed agents/interfaces.
</important>
