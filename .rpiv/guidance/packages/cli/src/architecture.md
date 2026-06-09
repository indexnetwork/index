# CLI Source

## Responsibility
Flat TypeScript CLI application: parse `index ...`, handle public auth commands, construct authenticated `ApiClient`, dispatch to command modules, and render JSON or terminal output.

## Dependencies
- **Node built-ins**: filesystem credentials, local login callback, browser open, readline REPL.
- **Global fetch/SSE streams**: backend REST and streaming chat.
- **Output facade**: centralized ANSI, tables/cards, markdown streaming.

## Consumers
- **`bin`/build scripts**: compile or execute `src/main.ts`.
- **Tests**: import parser, ApiClient, handlers, output renderers.

## Module Structure
```
src/
├── main.ts                 # auth boundary and command dispatcher
├── args.parser.ts          # plain ParsedCommand parser
├── api.client.ts           # REST/SSE/tool HTTP boundary
├── auth.store.ts, login.command.ts
├── *.command.ts            # one top-level command family per file
├── output/                 # terminal formatting and MarkdownRenderer
└── types.ts, sse.parser.ts # shared DTOs and parsing helpers
```

## Command Handler Pattern
```ts
export async function handleWidget(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options: { json?: boolean; limit?: number },
): Promise<void> {
  switch (subcommand) {
    case 'list': {
      const widgets = await client.listWidgets({ limit: options.limit });
      if (options.json) return console.log(JSON.stringify(widgets));
      output.widgetTable(widgets);
      return;
    }
    default:
      output.error(`Unknown widget subcommand: ${subcommand}`, 1);
  }
}
```

## ApiClient Boundary
```ts
class ApiClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async callTool(toolName: string, query: Record<string, unknown> = {}): Promise<ToolResult> {
    const res = await this.post(`/api/tools/${toolName}`, { query });
    return (await res.json()) as ToolResult; // command checks success envelope
  }

  private async get(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) await this.handleError(res); // throws HTTP errors
    return res;
  }
}
```

## Boundary Rules
- `parseArgs()` returns a plain DTO; no IO or API calls.
- `main.ts` owns auth; command modules receive an authenticated `ApiClient`.
- REST methods throw on HTTP errors; tool methods return `ToolResult` and commands must check `success`.
- `--json` prints raw DTO/tool envelopes and skips ANSI/progress output.

<important if="you are adding a CLI command">
1. Add command/subcommands to `ParsedCommand` and `KNOWN_COMMANDS` in `args.parser.ts`.
2. Create `src/<command>.command.ts` exporting `handleX`.
3. Add `ApiClient` methods or `callTool` usage; do not call `fetch` in command modules.
4. Import/dispatch from `main.ts` and add output formatters if needed.
5. Add parser, API client, command, and output tests.
</important>
