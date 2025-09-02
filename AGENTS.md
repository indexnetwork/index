# Repository Guidelines

This guide helps contributors work effectively in this mono‑repo.

## Project Structure & Module Organization
- `protocol/`: TypeScript Express API, LangGraph agents, Drizzle, Redis/Postgres.
- `frontend/`: Next.js (App Router) UI with Tailwind and ESLint.
- `docs/`, `README.md`, `HOWITWORKS.md`: Architecture and usage notes.
- `scripts/`: Utilities (e.g., `generate-ctx.sh`, optional `hooks/pre-commit`).
- `Makefile`: LLM context helpers (`ctx`, `ctx-full`, `ctx-public`, `ctx-clean`).

## Build, Test, and Development Commands
- Protocol
  - `cd protocol && yarn dev`: Start API with nodemon.
  - `yarn build && yarn start`: Compile TS then run `dist/`.
  - `yarn lint`: Lint server code.
  - `yarn db:generate | db:migrate | db:studio`: Drizzle generate/migrate/open studio.
- Frontend
  - `cd frontend && yarn dev`: Start Next.js (Turbopack).
  - `yarn build && yarn start`: Production build and serve.
  - `yarn lint`: Lint UI code.
- Convenience
  - `./dev.local.sh`: Run protocol and frontend together.
  - `make ctx` / `make ctx-public`: Generate and publish `llms-ctx*.txt`.

## Coding Style & Naming Conventions
- Language: TypeScript with `strict` in both apps.
- Formatting/Linting: ESLint; run `yarn lint` before PRs.
- Indentation: 2 spaces; semicolons per TS defaults.
- Naming: routes/libs lower-case (`protocol/src/routes/*.ts`); React components PascalCase (`frontend/src/components/*`); variables/functions camelCase; types/interfaces PascalCase.

## Testing Guidelines
- No formal test harness yet. Include manual verification steps in PRs.
- If adding tests: prefer Vitest + Testing Library (frontend) and lightweight integration tests (protocol). Aim ≥80% coverage for new logic.
- Keep tests close to code (e.g., `component.test.tsx`, `route.test.ts`).

## Commit & Pull Request Guidelines
- Commits: Imperative, concise; conventional prefixes encouraged: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`.
- PRs must include: scope, rationale, manual test notes; link issues. Add screenshots/GIFs for UI changes.
- Before opening: run `yarn lint` in both apps; run `make ctx` if `llms*.txt` changed (pre-commit hook can help).

## Security & Configuration Tips
- Env: `cp protocol/env.example protocol/.env` and set DB/keys (OpenAI, Resend, Redis). Never commit secrets.
- Postgres required for `protocol`; run migrations before `yarn start`.

