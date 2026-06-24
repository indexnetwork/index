<h1 align="center">
    <a href="https://index.network">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logos/logo-white-full.svg">
      <img width="400" src="apps/web/public/logos/logo-black-full.svg" alt="Index Network">
    </picture>
    </a>
</h1>

<p align="center">
  <i align="center">Discovery Protocol</i>
</p>

<h4 align="center">
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/mit-blue.svg?label=license" alt="license">
  </a>
  <br>
  <a href="https://x.com/indexnetwork_">
    <img src="https://img.shields.io/twitter/follow/indexnetwork_?style=social" alt="X">
  </a>
</h4>

## About Index Network

Index Network is a **private, intent-driven discovery protocol**. You or your agent tell it your intents — what you're looking for or what you can offer — and, in the background, agents negotiate over each other's intents: whether there's mutual interest, whether the timing is right, whether it's valuable to both sides, and everything in between.

When there's alignment between agents, that's called an **opportunity** — surfaced to you along with the reasoning for why it's worth your time.

## What makes it work

- **Intents, not profiles.** The unit of discovery is what you're seeking or offering right now — high-signal, time-aware, and private.
- **Agent-to-agent negotiation.** Two AI agents, one per person, negotiate over each other's intents before any introduction, so opportunities are mutually worthwhile by construction.
- **Bring your own agent.** Your personal agent can run inside your own MCP runtime — Claude Code, Codex, or any MCP-capable client — negotiating on your behalf. When no personal agent is connected, the system `Index Negotiator` steps in.
- **Opportunities you can reason about.** Every surfaced opportunity comes with the reasoning for why it's worth your time, not just a similarity score.
- **Private by design.** Index-based access control with granular permissions; discovery runs over embeddings and synthesized context, never raw profiles.

---


## CLI

The Index CLI lets you interact with the protocol directly from your terminal — chat with the AI agent, manage signals, review opportunities, and message other users.

### Installation

```bash
npm install -g @indexnetwork/cli
```

### Quick Start

```bash
# login + setup
index login
index profile

# 1. express intent (signals)
index intent create "federated learning collaboration"

# 2. check what the agents negotiated
index negotiation list --since 1h
index negotiation show <negotiation-id>

# 3. review outcomes (opportunities) and decide
index opportunity list --status pending
index opportunity show <opportunity-id>
index opportunity accept <opportunity-id>
```

## How it's built

Under the hood, an intent becomes an opportunity through a discovery pipeline:

```
  intent     ──▶   discovery      ──▶   evaluation    ──▶   negotiation   ──▶   opportunity
(seek/offer)      (context-to-intent    (fit scoring +       (agent-to-agent     (surfaced with
                   + premise search)     valency roles)       deliberation)       reasoning)
```
- **Intent** — structured intents (seeking or offering) with semantic embeddings, index-based access control, and quality scores (semantic entropy, felicity conditions) keeping inputs high-signal.
- **Discovery** — finds candidate intents across the network via context-to-intent and premise similarity search.
- **Evaluation** — scores each candidate for fit and assigns valency roles (seeker, provider, peer) that govern who sees the opportunity and when.
- **Negotiation** — the two parties' agents deliberate over each other's intents before anything is surfaced; the system `Index Negotiator` stands in when no personal agent is connected.
- **Opportunity** — surfaced to each party with dual-perspective, privacy-preserving reasoning — never the raw data.

**Core infrastructure:**

- **LangGraph** for the agent state machines (chat, intent, enrichment, opportunity, negotiation, and more) orchestrating complex workflows
- **PostgreSQL with pgvector** for 2000-dimensional semantic search (HNSW indexes)
- **Drizzle ORM** for type-safe, schema-driven database access
- **OpenRouter** for LLM-powered agents with Zod-validated structured output
- **BullMQ (Redis)** for asynchronous job processing and event-driven orchestration

The code follows strict inward-pointing layering — **Controllers -> Services -> Adapters -> Infrastructure** — with the self-contained `@indexnetwork/protocol` package (graphs, agents, tools) receiving all dependencies via constructor injection. See [docs/design/architecture-overview.md](docs/design/architecture-overview.md) for the full picture.

### Commands

| Command | Description |
|---|---|
| `index login` | Authenticate via browser (OAuth) or `--token` |
| `index logout` | Clear stored session |
| `index conversation` | Chat with the AI agent (REPL or one-shot) |
| `index conversation sessions` | List AI chat sessions |
| `index conversation list` | List all conversations (H2A + H2H) |
| `index conversation with <user-id>` | Open or resume a DM |
| `index profile` | Show your profile |
| `index profile sync` | Refresh your synthesized context |
| `index profile search <query>` | Search profiles by name |
| `index intent list` | List your signals |
| `index intent create <content>` | Create a signal |
| `index intent update <id> <text>` | Update a signal |
| `index intent link <id> <network>` | Link a signal to a network |
| `index opportunity list` | List your opportunities |
| `index opportunity accept/reject <id>` | Act on an opportunity |
| `index opportunity discover <query>` | Discover new opportunities |
| `index network list` | List your networks |
| `index network create <name>` | Create a network |
| `index network update <id>` | Update a network |
| `index network delete <id>` | Delete a network |
| `index contact list` | List your contacts |
| `index contact add <email>` | Add a contact by email |
| `index scrape <url>` | Scrape content from a URL |
| `index sync` | Sync context to ~/.index/context.json |

For the full command reference and rendered output examples, see [packages/cli/cli-output-reference.html](packages/cli/cli-output-reference.html).

## Getting Started

### Prerequisites

- **Bun** 1.2+ (runtime, package manager, test runner)
- **PostgreSQL** 14+ with **pgvector** 0.5+ extension
- **Redis** 6+ (for BullMQ job queues and caching)
- **Git** 2.30+

### Quick Start

For the full setup walkthrough (environment variables, database creation, troubleshooting), see [docs/guides/getting-started.md](docs/guides/getting-started.md).

1. **Clone the repository**

```bash
git clone https://github.com/indexnetwork/index.git
cd index
```

2. **Install dependencies**

```bash
bun install
```

3. **Set up environment variables**

```bash
cp services/api/.env.example services/api/.env
cp apps/web/.env.example apps/web/.env

# Edit services/api/.env: set DATABASE_URL, OPENROUTER_API_KEY, BETTER_AUTH_SECRET
```

4. **Initialize the database**

```bash
cd services/api
bun run db:migrate
bun run db:seed       # optional: populate sample data
```

5. **Start the development servers**

```bash
# Terminal 1: API service (port 3001)
cd services/api
bun run dev

# Terminal 2: Web dev server (port 3000, proxies /api to API service)
cd apps/web
bun run dev
```

Visit `http://localhost:3000` to see the application.

## Development

### Project Structure

```
index/
├── apps/
│   ├── web/           # Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
│   └── mac/           # Native Apple client subtree → indexnetwork/mac-client
├── services/
│   └── api/           # Backend API and agent engine (Bun, TypeScript)
├── packages/          # Shared protocol, CLI, Claude plugin, and Hermes plugin packages
├── docs/              # Project documentation (see Documentation section)
└── scripts/           # Worktree helpers, hooks, dev launcher
```

## Protocol Implementation

The `services/api/` directory contains the core agent infrastructure:

### Key Components

- **Agents**: LangGraph-based agents for intent inference, opportunity evaluation, user enrichment, and agent-to-agent negotiation
- **Graph Workflows**: state machines (Chat, Intent, Enrichment, Opportunity, HyDE, Network, NetworkMembership, IntentNetwork, Home, Maintenance, Negotiation) orchestrating complex operations
- **Database Layer**: PostgreSQL with pgvector for semantic search and Drizzle ORM for type safety
- **Semantic Governance**: Intent quality validation using speech act theory and felicity conditions

### Development Commands

For the full list of API service commands (DB, workers, maintenance), see [CLAUDE.md](CLAUDE.md).

```bash
cd services/api

# Start development server (Bun.serve, port 3001)
bun run dev

# Database operations
bun run db:generate    # Generate migrations after schema changes
bun run db:migrate     # Run database migrations
bun run db:studio      # Open Drizzle Studio (DB GUI)

# Code quality
bun run lint           # Run ESLint
```

## Documentation

Detailed documentation lives in the `docs/` directory:

### Guides

- **[Getting Started](docs/guides/getting-started.md)** -- Full setup walkthrough with prerequisites, environment config, database setup, and troubleshooting

### Design

- **[Architecture Overview](docs/design/architecture-overview.md)** -- Monorepo structure, protocol layering, agent system, data flow diagrams
- **[Protocol Deep Dive](docs/design/protocol-deep-dive.md)** -- Detailed graph, agent, and tool documentation with sequence diagrams

### Domain

- **[Intents](docs/domain/intents.md)** -- Intent lifecycle, semantic governance, speech act validation
- **[Opportunities](docs/domain/opportunities.md)** -- Opportunity detection, evaluation, and persistence
- **[Negotiation](docs/domain/negotiation.md)** -- Bilateral agent-to-agent negotiation protocol
- **[Identity and Context](docs/domain/identity-and-context.md)** -- User identity, synthesized context, enrichment, and HyDE document embeddings
- **[Indexes](docs/domain/networks.md)** -- Community structure, membership, and access control
- **[HyDE](docs/domain/hyde.md)** -- Hypothetical Document Embedding strategies for semantic search
- **[Feed and Maintenance](docs/domain/feed-and-maintenance.md)** -- Home feed curation and periodic maintenance

### Specs

- **[API Reference](docs/specs/api-reference.md)** -- REST API endpoints, authentication, request/response formats
- **[CLI Reference](packages/cli/cli-output-reference.html)** -- Full rendered output reference for every CLI command
- **[CLI Reference Spec](docs/specs/cli-reference.md)** -- Complete CLI command behavior specification
- **[CLI npm Distribution](docs/specs/cli-npm-publish.md)** -- Platform-specific binary distribution via npm

## Contributing

We welcome contributions! Before submitting a Pull Request:

1. **Get Assigned**: Comment on an existing issue or create a new one
2. **Fork & Branch**: Create a feature branch from `dev` (not `main`)
3. **Use Worktrees**: Work in a git worktree to keep `dev` stable
4. **Test**: Ensure all tests pass and add tests for new features
5. **Document**: Update relevant documentation
6. **Submit**: Open a PR targeting `dev` with a clear description

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/index.git
cd index

# Create a worktree for your feature
git worktree add .worktrees/feat-your-feature dev
bun run worktree:setup feat-your-feature

# Start dev servers from the worktree
bun run worktree:dev feat-your-feature

# Make changes and test
cd services/api && bun test path/to/affected.spec.ts

# Submit PR targeting dev
gh pr create --base dev --title "feat: your feature" --body "..."
```

## Resources

- **[index.network](https://index.network)** - Production application
- **[GitHub](https://github.com/indexnetwork/index)** - Source code and issue tracking
- **[Twitter](https://x.com/indexnetwork_)** - Latest updates and announcements
- **[Blog](https://blog.index.network)** - Latest insights and updates
- **[Book a Call](https://calendly.com/d/2vj-8d8-skt/call-with-seren-and-seref)** - Chat with founders

## License

Index Network is licensed under the MIT License. See [LICENSE](LICENSE) for details.
