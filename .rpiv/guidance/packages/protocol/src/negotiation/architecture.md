# Protocol Negotiation

## Responsibility
Bilateral agent negotiation domain. Defines turn/outcome schemas, runs `init → turn → finalize`, dispatches personal agents before system fallback, exposes negotiation MCP tools, and summarizes outcomes.

## Dependencies
- **LangGraph**: negotiation state machine.
- **Zod**: turn/outcome/tool schemas.
- **AgentDispatcher interface**: personal-agent transport boundary.
- **Structured LLM models**: `IndexNegotiator`, summarizer, insights generator.

## Consumers
- **Opportunity graph**: negotiates candidates and existing opportunities.
- **Backend queues/services/MCP**: run background negotiation and external-agent tools.

## Module Structure
```
negotiation/
├── negotiation.state.ts       # Zod schemas, state annotations, public types
├── negotiation.graph.ts       # graph factory and candidate fan-out
├── negotiation.agent.ts       # system fallback negotiator
├── negotiation.tools.ts       # list/get/respond tools
├── summarizer/insight files   # downstream compression/narrative helpers
└── tests/                     # graph, tools, timeout, summarizer specs
```

## Schema-First Turn Contract
```ts
export const NegotiationTurnSchema = z.object({
  action: z.enum(['propose', 'accept', 'reject', 'counter', 'question']),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({ ownUser: RoleSchema, otherUser: RoleSchema }),
  }),
  message: z.string().nullable().optional(),
});

export const SystemNegotiationTurnSchema = NegotiationTurnSchema.extend({
  action: z.enum(['propose', 'accept', 'reject', 'counter']),
});
```

## Dispatcher-First Turn Node
```ts
const dispatched = await dispatcher.dispatch(ownUser.id, scope, payload, { timeoutMs });

if (dispatched.handled) turn = dispatched.turn;
else if (dispatched.reason === 'waiting') {
  await database.setTaskTurnContext(taskId, absoluteSourceCandidateContext);
  await database.updateTaskState(taskId, 'waiting_for_agent');
  return { status: 'waiting_for_agent' };
} else {
  turn = await new IndexNegotiator().invoke(payload); // system fallback
}
```

## A2A DataPart Persistence
```ts
await database.createMessage({
  conversationId,
  senderId: `agent:${ownUser.id}`,
  role: 'agent',
  parts: [{ kind: 'data', data: turn }],
  taskId,
});
```

## Boundary Rules
- Store parked context in absolute `source/candidate` terms; project to caller-relative `own/other` in tools.
- First non-continuation graph turn must be `propose`; final system turn is only `accept|reject`.
- Tools must enforce network scope, participant access, task state, and turn parity before responding.

<important if="you are adding negotiation behavior">
1. Update Zod schemas first, then inferred types and prompts.
2. Update graph routing/finalization and `respond_to_negotiation` tool validation together.
3. Preserve DataPart message envelope and `negotiation-outcome` artifact shape.
4. Add tests for schema, graph routing, external tool response, and timeout/fallback paths.
</important>
