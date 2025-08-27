# Repository Guidelines

## Project Structure & Module Organization
- `protocol/`: TypeScript Express server, LangGraph agents, Drizzle migrations, Redis/Postgres integration.
- `frontend/`: Next.js app (App Router) with Tailwind and ESLint.
- `docs/`, `README.md`, `HOWITWORKS.md`: Architecture and usage.
- `scripts/`: Utility scripts (e.g., `generate-ctx.sh`, optional `hooks/pre-commit`).
- Top-level `Makefile`: LLM context helpers (`ctx`, `ctx-full`, `ctx-public`, `ctx-clean`).

## Build, Test, and Development Commands
- Protocol:
  - `cd protocol && yarn dev`: Start API with nodemon.
  - `yarn build && yarn start`: Compile TypeScript then run from `dist/`.
  - `yarn lint`: Lint server code.
  - `yarn db:generate | db:migrate | db:studio`: Drizzle operations.
- Frontend:
  - `cd frontend && yarn dev`: Start Next.js (Turbopack).
  - `yarn build && yarn start`: Production build and serve.
  - `yarn lint`: Lint UI code.
- Convenience:
  - `./dev.local.sh`: Run protocol and frontend together.
  - `make ctx` / `make ctx-public`: Generate and publish `llms-ctx*.txt` assets.

## Coding Style & Naming Conventions
- Language: TypeScript with `strict` mode enabled in both apps.
- Formatting/Linting: ESLint (`frontend` extends Next core web vitals). Run `yarn lint` before PRs.
- Indentation: 2 spaces; semicolons standard TS defaults.
- Naming: 
  - Files/folders: lower-case for routes and libs (`protocol/src/routes/*.ts`); React components PascalCase (`frontend/src/components/*`).
  - Variables/functions camelCase; types/interfaces PascalCase.

## Testing Guidelines
- No formal test framework configured yet. For changes, include manual verification steps in the PR.
- If adding tests, prefer Vitest + Testing Library (frontend) and lightweight integration tests (protocol). Keep coverage for new logic ≥80% when feasible.

## Commit & Pull Request Guidelines
- Commits: Imperative, concise. Conventional prefixes encouraged: `feat:`, `fix:`, `chore:`, `docs:`, `ci:` (seen in history).
- PRs must include: clear description, scope, rationale, manual test notes; link issues. Add screenshots/GIFs for UI changes.
- Before opening: `yarn lint` in both apps; run `make ctx` if `llms*.txt` changed (pre-commit hook can help).

## Security & Configuration Tips
- Copy envs: `cp protocol/env.example protocol/.env` and configure DB/keys (OpenAI, Resend, Redis). Do not commit secrets.
- Postgres is required for protocol; confirm migrations run before `yarn start`.
