# Backend Controllers

## Responsibility
HTTP and MCP request boundary. Controllers parse/validate input, run guards, call services or protocol composition roots, and convert results to HTTP responses.

## Dependencies
- **Route decorators/registry**: `@Controller`, `@Get`, `@Post`, `@UseGuards` define routes.
- **Guards/rate limiter**: auth, API key, scope, and rate-limit boundaries.
- **Zod/manual parsing**: request validation before service calls.

## Consumers
- **`backend/src/main.ts`**: imports/registers controllers.
- **HTTP clients**: frontend, CLI, MCP clients through API routes.

## Module Structure
```
controllers/
├── *.controller.ts       # one resource/API boundary per domain
├── mcp.controller.ts     # composition root exception for protocol deps
└── tests/                # controller/request behavior specs
```

## Decorated Request Boundary
```ts
@Controller('/api/widgets')
export class WidgetController {
  constructor(private readonly service = widgetService) {}

  @Get('/')
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
  async list(req: Request) {
    const userId = requireUser(req);
    const result = await this.service.list(userId);
    return Response.json({ widgets: result });
  }

  @Post('/')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async create(req: Request) {
    const body = CreateWidgetSchema.parse(await req.json());
    return Response.json({ widget: await this.service.create(body) }, { status: 201 });
  }
}
```

## MCP Composition Root Exception
```ts
// mcp.controller.ts may assemble protocol deps; normal controllers should not.
const deps: ProtocolDeps = {
  database: databaseAdapter,
  embedder: embedderAdapter,
  questionerEnqueue: questionerQueue.addJob.bind(questionerQueue),
};
```

## Boundary Rules
- Do not put business persistence in controllers.
- Put `RateLimit(...)` before auth guards so throttling happens before DB work.
- Use `assertAgentNetworkScope` or scoped service filters on agent-facing routes.

<important if="you are adding a new endpoint">
1. Add/extend service method first.
2. Add controller method with guard order: rate limit, then auth/scope guard.
3. Parse params/body explicitly or with Zod.
4. Return response envelopes matching nearby endpoints.
5. Add targeted controller tests for validation, auth/scope, and success.
</important>
