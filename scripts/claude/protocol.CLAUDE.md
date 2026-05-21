# CLAUDE.md — @indexnetwork/protocol

Agent graphs, interfaces, and tools layer of Index Network. Published as an npm package; consumed by `backend/` as a versioned dependency. Zero imports from the app — all infrastructure is injected via constructor through the interfaces in `shared/interfaces/`.

## Commands

```bash
bun run build    # Compile TypeScript → dist/
bun run dev      # Watch mode
bun test         # Run tests
```

## Public API surface

`src/index.ts` is the **only export point**. When adding a new export, add it there under the appropriate section comment. Do not let consumers import from deep paths like `@indexnetwork/protocol/src/foo/bar`.

## Adding a new tool

Tools live in `{domain}/{domain}.tools.ts` and are registered in `shared/agent/tool.registry.ts`.

1. Add a `create{Domain}Tools` function in `{domain}/{domain}.tools.ts`, using `defineTool` with a Zod `querySchema`.
2. Import and call it in `tool.registry.ts` — it registers entries into the shared `ToolRegistry` map.
3. The MCP server (`mcp/mcp.server.ts`) and the chat agent pick up all registered tools automatically.

## Adding a new graph

Each domain exposes a `*GraphFactory` class. Pattern:

1. `{domain}/{domain}.state.ts` — LangGraph `StateGraph` annotation + types.
2. `{domain}/{domain}.graph.ts` — `*GraphFactory` class; constructor receives typed deps (subsets of the interfaces in `shared/interfaces/`). Compile graph in the constructor.
3. Export the factory from `src/index.ts`.

Graphs must not import from `backend/` or call `configureProtocol` — they call `createModel()` from `shared/agent/model.config.ts`.

## Adding a new infrastructure interface

1. Create `shared/interfaces/{concept}.interface.ts` with the interface and any supporting types.
2. Export it from `src/index.ts` under the `// ─── Interfaces` section.
3. The backend's `src/adapters/` will implement it and inject it at composition root (`src/protocol-init.ts`). Adapters must not import from this package's interfaces — they define their own aligned types.

## Skills templates

`skills/` holds the source templates for the SKILL.md files shipped in `packages/claude-plugin/` and `packages/openclaw-plugin/`. **Edit the templates here**, then run `scripts/build-skills.ts` from the monorepo root to regenerate the output files. Never edit the generated SKILL.md files directly.

```
skills/
├── core-guidance.partial.md        # Shared partial injected into all templates
├── claude-plugin/
│   ├── index-orchestrator.template.md
│   └── index-negotiator.template.md
└── openclaw/
    └── SKILL.md.template
```

## Testing

Target specific test files — the full suite is slow:

```bash
bun test src/intent/tests/intent.graph.test.ts
bun test src/negotiation/tests/
```

Test files live alongside the code they test under `{domain}/tests/`.
