# Index Network Web App

Single-page application for Index Network. Built with **Vite**, **React Router v7**, **React 19**, **Tailwind CSS 4**, and **Radix UI**.

For project overview and full dev commands, see the [root README](../../README.md) and [CLAUDE.md](../../CLAUDE.md).

## Getting Started

```bash
bun install            # from the repo root
bun run dev            # start the Vite dev server
```

In development, Vite proxies `/api/*` to the API service on port `3001`. The dev server listens on port `3000` (configured in `vite.config.ts`).

## Environment

Copy `.env.example` to `.env` and adjust as needed. See `src/env.ts` for the list of variables consumed by the app.

The web app uses [Better Auth](https://www.better-auth.com/) for session-based authentication. When developing against a local API service, make sure the web origin is listed in Better Auth `trustedOrigins` config or you will see `invalid_origin` errors on login.

## Structure

```
src/
  app/          Page components (lazy-loaded route modules)
  components/   Reusable React components
  contexts/     React Context providers
  services/     Typed fetch wrappers for the API service
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start Vite dev server with API proxy |
| `bun run build` | Build blog assets then run a Vite production build |
| `bun run start` | Start Vite preview server against the built bundle |
| `bun run lint` | Run ESLint |
