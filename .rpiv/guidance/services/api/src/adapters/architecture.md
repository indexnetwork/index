# Backend Adapters

## Responsibility
Infrastructure boundary for databases, cache, storage, scraping, email, and external APIs. Adapters implement backend persistence and structurally satisfy protocol interfaces without importing protocol adapter implementations.

## Dependencies
- **Drizzle/PostgreSQL**: typed SQL and schema mapping.
- **Redis/cache clients**: shared cache/queue storage where applicable.
- **External SDKs/APIs**: isolated behind adapter methods.

## Consumers
- **Services and queues**: call adapters for IO.
- **MCP/protocol composition roots**: inject adapters into protocol factories.

## Module Structure
```
adapters/
├── *.adapter.ts              # infrastructure adapter by concept, not vendor
├── *.database.adapter.ts     # Drizzle-backed domain persistence
├── cache/storage/email/etc.  # external IO boundaries
└── tests/                    # adapter contract/integration tests
```

## Plain Return Repository Boundary
```ts
export class WidgetDatabaseAdapter {
  async getWidget(id: string): Promise<Widget | null> {
    const [row] = await db.select().from(widgets).where(eq(widgets.id, id)).limit(1);
    return row ? toWidget(row) : null; // not Result<T>
  }

  async createWidget(input: CreateWidgetInput): Promise<Widget> {
    const [row] = await db.insert(widgets).values(input).returning();
    if (!row) throw new Error('createWidget: no row returned');
    return toWidget(row);
  }
}
```

## Protocol Interface Implementation
```ts
// Protocol defines the narrow contract; backend adapter implements structurally.
type ProtocolNeeds = Pick<DatabaseAdapter, 'getUser' | 'searchIntentsByEmbedding'>;

const deps: ProtocolNeeds = databaseAdapter;
```

## Boundary Rules
- Return `T`, `T | null`, arrays, booleans, or throw for invariants; do not wrap DB calls in HTTP responses.
- Map DB rows to domain DTOs at the adapter boundary.
- Keep auth/scope-specific reads explicit; do not hide broad queries behind unsafe helpers.

<important if="you are adding adapter methods">
1. Add the narrow method required by the service/protocol interface.
2. Use canonical schema from `services/api/src/schemas/database.schema.ts`.
3. Return plain values/null and throw only for invariant failures.
4. Add tests for not-found, empty result, scope/visibility, and successful mapping.
</important>
