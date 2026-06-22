# Protocol Chat

## Responsibility
Chat orchestration layer: constructs chat graphs, binds tools, streams assistant/tool events, and manages ReAct-style model interaction for user sessions.

## Dependencies
- **LangGraph/LangChain**: graph/agent message flow.
- **Shared tool factory/registry**: binds protocol tools into chat agents.
- **Model config/request context**: model selection, abort signals, trace events.

## Consumers
- **Backend MCP/chat controllers and services**: instantiate `ChatGraphFactory` and sessions.
- **Protocol tool factory**: shares tool/context contracts.

## Module Structure
```
chat/
├── chat.graph.ts        # graph factory and streaming orchestration
├── chat.agent.ts        # ChatAgent.create and model/tool binding
├── chat.state.ts        # graph state contracts
├── tools/context files  # chat-specific tool context helpers
└── tests/               # graph/agent behavior specs
```

## Private Factory Agent Pattern
```ts
export class ChatAgent {
  private constructor(private readonly model: ChatModel, private readonly tools: Tool[]) {}

  static create(context: ToolContext) {
    const model = createModel('chat', context.modelConfig).bindTools(context.tools);
    return new ChatAgent(model, context.tools);
  }

  async invoke(messages: BaseMessage[], options?: { signal?: AbortSignal }) {
    return invokeWithAbortSignal(this.model, messages, options?.signal);
  }
}
```

## Trace Event Pattern
```ts
const emit = requestContext.getStore()?.traceEmitter;
emit?.({ type: 'agent_start', agent: 'chat-agent', sessionId });
try {
  const response = await agent.invoke(messages, { signal });
  emit?.({ type: 'agent_end', agent: 'chat-agent', ok: true });
  return response;
} catch (error) {
  emit?.({ type: 'agent_end', agent: 'chat-agent', ok: false });
  throw error;
}
```

## Boundary Rules
- Chat binds tools; individual tool logic belongs in domain tool factories.
- Preserve streaming event contracts consumed by apps/web/CLI renderers.
- Only `ChatAgent` reads per-request `ModelConfig` from `ToolContext`.

<important if="you are adding chat-visible tool behavior">
1. Add the domain tool in its owning package folder.
2. Register it through shared tool factory/registry.
3. Ensure streaming/tool activity events remain stable for frontend and CLI.
4. Add tests for tool binding and response/reset behavior if streaming changes.
</important>
