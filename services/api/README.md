# API Service

Backend API and agent engine for Index Network: Bun runtime, Bun.serve routing, Drizzle ORM, PostgreSQL with pgvector, BullMQ, and LangChain/LangGraph.

## Quick start

```bash
# Install dependencies (from repo root)
bun install

# Development: Bun server (Bun.serve, port 3001)
bun run dev

# Database
bun run db:generate   # Generate migrations after schema changes
bun run db:migrate    # Apply migrations
bun run db:studio     # Drizzle Studio (DB GUI)
```

## More

- **[../../README.md](../../README.md)** — Project overview and getting started
- **[../../CLAUDE.md](../../CLAUDE.md)** — Full development commands, architecture, and conventions
