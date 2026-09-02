<h1 align="center">
    <a href="https://index.network">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logos/logo-white-full.svg">
      <img width="400" src="apps/web/public/logos/logo-black-full.svg" alt="Index Network">
    </picture>
    </a>
</h1>

<p align="center">
  <i align="center">Social Discovery Protocol</i>
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


<p align="center">
  <i>A live trace: watch one intent turn into opportunities in real time.</i>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/media/trace-video-github-dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="apps/web/public/media/trace-video-github-light.webp">
    <img alt="Index Network discovery protocol" src="apps/web/public/media/trace-video-github-light.webp" width="800">
  </picture>
</p>


## Protocol Overview

Four primitives make up the protocol:

- **Intent** — What you're looking for or what you can offer, declared to the protocol by you or your agent. Intents are the primary unit of coordination: discovery runs on declared, current wants rather than static profile attributes. Each intent has a privacy type that governs its exposure:
  - `public` — discoverable and readable by anyone.
  - `network_only` — shared only within the networks you've assigned it to.
  - `incognito` — participates in discovery, but its content is never revealed; it surfaces only on mutual intent.
  - `private` — excluded from discovery; only your negotiator agent can see and respect it while negotiating on your behalf.
- **Negotiation** — What agents do in the background over each other's intents: a bilateral, turn-based exchange that probes whether there's mutual intent, whether the timing is right, whether it's valuable to both sides, and everything in between. Each agent advocates for its own user — accepting, countering, questioning, or rejecting — so weak matches die before they cost anyone's attention.
- **Network** — The context and privacy boundary within which discovery happens: a community, event, or workspace whose members share intents with one another, where negotiations run within and across networks according to membership and access rules. An intent can belong to multiple networks at once.
- **Opportunity** — What emerges when negotiating agents align. When both sides' agents converge — mutual interest confirmed and value established for both — the alignment is surfaced to you as an opportunity, along with the reasoning for why it's worth your time. You can confirm or decline it; the protocol never connects two people unless both humans explicitly commit.




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

### Inspect the Protocol

Intent detail:

```console
$ index intent show <intent-id>

Signal Details
────────────────────────────────────────
Status          ACTIVE
Summary         Build a secure identity layer for autonomous agents
Confidence      ########-- 82%

Network Assignments
* AI Research Collaborations (0.92)
* Crypto & Identity (0.78)
```

Negotiation detail:

```console
$ index negotiation show <negotiation-id>

Negotiation Details
────────────────────────────────────────
Counterparty    Alex Chen
Outcome         opportunity
Your Role       helper
Turns           3

Turn-by-Turn
Turn 1  Your Agent    propose  Shared intent and complementary expertise.
Turn 2  Alex's Agent  counter  Reframed this as a peer collaboration.
Turn 3  Your Agent    accept   Strong alignment on verification mechanisms.
```

Opportunity detail:

```console
$ index opportunity show <opportunity-id>

Opportunity
────────────────────────────────────────
Status:       pending
Category:     Research Collaboration
Confidence:   ########-- 87%

Parties:
  You         Seeker
  Alex Chen   Helper
  David Kim   Peer

Reasoning:
  Shared interest in decentralized identity protocols,
  with complementary research and infrastructure expertise.

Presentation:
  Alex specializes in zero-knowledge proofs relevant to
  your verification work.
```

## Documentation

The repository has no `docs/` directory. Agent and contributor guidance lives in
`CLAUDE.md` and `AGENTS.md` at the root: repository map, commands, naming and import
conventions, environment and Neon topology, the migration checklist, and the git and
release workflow.

Per-package detail lives in the package itself:

- **[packages/protocol/README.md](packages/protocol/README.md)** -- the protocol package,
  with `STABILITY.md` for tiers and SemVer policy and `IMPLEMENTATION.md` for host-side
  wiring and the interface list
- **[packages/protocol/src/README.md](packages/protocol/src/README.md)** -- source layout
  and capability boundaries
- **[CLI Reference](packages/cli/cli-output-reference.html)** -- full rendered output
  reference for every CLI command
- **[apps/mac/README.md](apps/mac/README.md)** -- the macOS shell


## Development

### Prerequisites

- **Bun** 1.2+ (runtime, package manager, test runner)
- **PostgreSQL** 14+ with **pgvector** 0.5+ extension
- **Redis** 6+ (cache, locks, and SSE)
- **Git** 2.30+

### Setup

Environment variables are documented in the root `.env.example`; the database and Neon topology are covered in `CLAUDE.md`.

1. **Clone the repository**

```bash
git clone https://github.com/indexnetwork/index.git
cd index
```

1. **Install dependencies**

```bash
bun install
```

1. **Set up environment variables**

```bash
cp .env.example .env.development

# Edit .env.development: set DATABASE_URL, OPENROUTER_API_KEY, BETTER_AUTH_SECRET
```

1. **Initialize the database**

```bash
cd services/api
bun run db:migrate
bun run db:seed       # optional: populate sample data
```

1. **Start the development servers**

```bash
# Terminal 1: API service (port 3001)
cd services/api
bun run dev

# Terminal 2: Web dev server (port 3000, proxies /api to API service)
cd apps/web
bun run dev
```

Visit `http://localhost:3000` to see the application.

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



### Development Commands

The full command list, including maintenance scripts, is in `CLAUDE.md`.

```bash
cd services/api

# Database operations
bun run db:generate    # Generate migrations after schema changes
bun run db:studio      # Open Drizzle Studio (DB GUI)

# Code quality
bun run lint           # Run ESLint
```



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

# Create and set up a standalone worktree
git fetch origin dev
git worktree add -b feat/your-feature .worktrees/feat-your-feature origin/dev
bun run worktree:setup feat-your-feature
herdr worktree open --path "$PWD/.worktrees/feat-your-feature" \
  --label feat-your-feature --no-focus --json

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
