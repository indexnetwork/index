# Protocol Shared

## Responsibility
Cross-domain protocol primitives: model config, tool registry/factory, request context/observability, schemas, utility functions, and reusable interfaces.

## Dependencies
- **LangChain/LangGraph contracts**: shared tool/model invocation patterns.
- **Zod**: common validation and tool schemas.
- **Async request context**: trace/event propagation.

## Consumers
- **Protocol domains**: chat, intent, opportunity, negotiation, questioner, maintenance.
- **Backend**: imports shared interfaces and tool factories for composition.

## Module Structure
```
shared/
├── agent/                # model config, tool factory/registry, invocation helpers
├── interfaces/           # host-implemented ports/contracts
├── schemas/              # shared Zod schemas and DTO contracts
├── observability/logging # request context, traces, timing helpers
└── utils                 # pure helpers used across protocol domains
```

## Shared Model Invocation Pattern
```ts
const model = createModel('featureAgent').withStructuredOutput(OutputSchema, {
  name: 'feature_agent_output',
});

const raw = await invokeWithAbortSignal(model, [
  new SystemMessage(SYSTEM_PROMPT),
  new HumanMessage(renderInput(input)),
], options?.signal);

const parsed = OutputSchema.safeParse(raw);
return parsed.success ? parsed.data : null;
```

## Tool Registry Pattern
```ts
export function createToolSet(defineTool: DefineTool, deps: ToolDeps) {
  return [
    ...createIntentTools(defineTool, deps),
    ...createOpportunityTools(defineTool, deps),
    ...(deps.agentDispatcher ? createNegotiationTools(defineTool, deps) : []),
  ];
}
```

## Boundary Rules
- Add shared code only when at least two protocol domains need it.
- Keep helpers pure unless the folder explicitly owns runtime context/model/tool behavior.
- Avoid creating broad god interfaces; prefer focused contracts in domain modules.

<important if="you are adding shared protocol utilities">
1. Verify the helper is cross-domain; otherwise keep it in the owning domain folder.
2. Prefer pure functions with unit tests.
3. If adding model/tool behavior, preserve abort-signal and trace conventions.
4. Re-export only stable public contracts from package root.
</important>
