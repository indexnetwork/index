<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/logo-black.svg">
    </a>
    <a href="https://index.network/#gh-dark-mode-only">
    <img style="width:400px" src="https://index.network/logo.svg">
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
  <a href="https://discord.gg/wvdxP6XvYu">
    <img src="https://img.shields.io/badge/discord-7289da.svg" alt="discord">
  </a>
  <a href="https://x.com/indexnetwork_">
    <img src="https://img.shields.io/twitter/follow/indexnetwork_?style=social" alt="X">
  </a>
</h4>

## About Index Network

Index Network enables **private, intent-driven discovery** through a sophisticated opportunity detection system. Users express what they're seeking as structured intents, and the protocol identifies **opportunities** -- legible coordination points that emerge when aligned intents intersect with trust thresholds, timing constraints, and expected value calculations, making action rational for all parties involved.

Unlike traditional matching systems that operate on profile similarity, Index treats opportunities as **first-class coordination primitives**: they exist as distinct entities with their own lifecycle, interpretations, and contextual metadata, enabling nuanced understanding of *why* and *when* a connection makes sense, not just *that* it matches.

## Key Features

### Private Intent-Driven Discovery

- **Intent-Based**: Express specific needs like "finding a privacy-focused AI engineer"
- **Privacy by Design**: Index-based access control with granular permissions
- **Opportunity Detection**: Context-aware agents surface coordination points when intents align
- **Semantic Understanding**: Vector similarity and HyDE strategies for intelligent matching
- **Agent Orchestration**: LangGraph-powered workflows for complex discovery tasks
- **Bilateral Negotiation**: Two AI agents -- one per user -- debate proposed matches before they become opportunities, ensuring both sides genuinely benefit

## How It Works

1. **Users Express Intents**: Define what you're seeking in natural language
2. **Context Organization**: Group intents into indexes with privacy controls
3. **Opportunity Detection**: Agents identify coordination points when profiles and intents align
4. **Bilateral Negotiation**: A proposer and responder agent debate each match, agreeing on fit scores and roles before persisting
5. **Connection Facilitation**: Dual-perspective descriptions preserve privacy while explaining value
6. **Continuous Discovery**: Profile updates trigger new opportunity searches

## Architecture

```
+------------------------+    +------------------------+    +------------------------+
|   Intent Graph         |--->|  Opportunity Engine     |--->|  Discovery Layer       |
|                        |    |                        |    |                        |
| - Semantic vectors     |    | - Multi-strategy       |    | - Bilateral            |
| - Index partitions     |    |   HyDE generation      |    |   negotiation          |
| - Speech act types     |    | - 4-dimensional        |    | - Dual synthesis       |
| - Felicity scores      |    |   threshold eval       |    | - Contextual           |
| - Temporal decay       |    | - Confidence scoring   |    |   integrity            |
+------------------------+    +------------------------+    +------------------------+
```

**Three-Layer Architecture**:

1. **Intent Graph**: Structured intent storage with semantic embeddings, speech act validation, and index-based access control. Intents are first-class entities with quality scores (semantic entropy, felicity conditions) ensuring high-signal inputs.

2. **Opportunity Engine**: Multi-dimensional detection system that generates hypothetical documents (HyDE) across LLM-inferred search lenses, evaluates candidates against trust/timing/value/alignment thresholds, and produces scored opportunities with dual-perspective interpretations.

3. **Discovery Layer**: Privacy-preserving presentation system with bilateral negotiation. Two AI agents (proposer and responder) debate each candidate match before it becomes a real opportunity. Each party receives synthesized insights about potential connections without exposure to raw private data.

**Core Infrastructure**:

- **LangGraph** for 11 agent state machines (intent, opportunity, negotiation, profile, chat, and more) orchestrating complex workflows
- **PostgreSQL with pgvector** for 2000-dimensional semantic search (HNSW indexes)
- **Drizzle ORM** for type-safe database operations with schema-driven types
- **OpenRouter** for LLM-powered agents with Zod-validated structured output
- **BullMQ (Redis)** for asynchronous job processing and event-driven orchestration

## CLI

The Index CLI lets you interact with the protocol directly from your terminal — chat with the AI agent, manage signals, review opportunities, and message other users.

### Installation

```bash
npm install -g @indexnetwork/cli
```

### Quick Start

```bash
# Authenticate (opens browser)
index login

# Chat with the AI agent (interactive REPL)
index conversation

# One-shot message
index conversation "What opportunities do I have?"

# Browse your signals
index intent list

# Discover opportunities by search
index opportunity discover "looking for an AI engineer"

# Propose a direct connection with someone
index profile search "Jane Smith"
index opportunity discover "collaborate on LLM tooling" --target <user-id>

# Introduce two people
index opportunity discover --introduce <user-id-a> <user-id-b>

# Review and accept
index opportunity list --status pending
index opportunity accept <id>
```

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
| `index profile sync` | Regenerate your profile |
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
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Edit backend/.env: set DATABASE_URL, OPENROUTER_API_KEY, BETTER_AUTH_SECRET
```

4. **Initialize the database**

```bash
cd backend
bun run db:migrate
bun run db:seed       # optional: populate sample data
```

5. **Start the development servers**

```bash
# Terminal 1: Backend server (port 3001)
cd backend
bun run dev

# Terminal 2: Frontend dev server (port 3000, proxies /api to backend)
cd frontend
bun run dev
```

Visit `http://localhost:3000` to see the application.

## Development

### Project Structure

```
index/
├── backend/           # Backend API and agent engine (Bun, Express, TypeScript)
├── frontend/          # Vite + React Router v7 SPA (React 19, Tailwind CSS 4)
├── docs/              # Project documentation (see Documentation section)
└── scripts/           # Worktree helpers, hooks, dev launcher
```

## Protocol Implementation

The `backend/` directory contains the core agent infrastructure:

### Key Components

- **Agents**: LangGraph-based agents for intent inference, opportunity evaluation, profile generation, and bilateral negotiation
- **Graph Workflows**: 11 state machines (Chat, Intent, Index, Index Membership, Intent Index, Opportunity, Negotiation, Profile, HyDE, Home, Maintenance) orchestrating complex operations
- **Database Layer**: PostgreSQL with pgvector for semantic search and Drizzle ORM for type safety
- **Semantic Governance**: Intent quality validation using speech act theory and felicity conditions

### Development Commands

For the full list of backend commands (DB, workers, maintenance), see [CLAUDE.md](CLAUDE.md).

```bash
cd backend

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
- **[Profiles](docs/domain/profiles.md)** -- User profile generation and HyDE document embeddings
- **[Networks](docs/domain/networks.md)** — Community structure, membership, and access control
- **[HyDE](docs/domain/hyde.md)** -- Hypothetical Document Embedding strategies for semantic search
- **[Feed and Maintenance](docs/domain/feed-and-maintenance.md)** -- Home feed curation and periodic maintenance

### Specs

- **[API Reference](docs/specs/api-reference.md)** -- REST API endpoints, authentication, request/response formats
- **[CLI Reference](packages/cli/cli-output-reference.html)** -- Full rendered output reference for every CLI command
- **[CLI v1 Spec](docs/specs/cli-v1.md)** -- Login and conversation command specification
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
cd backend && bun test path/to/affected.spec.ts

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
