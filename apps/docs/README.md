# @indexnetwork/docs

The protocol documentation site, built with [Vocs](https://vocs.dev) (Vite +
React + MDX). Content lives in `src/pages`; the sidebar is `vocs.config.ts`.

```bash
cd apps/docs
bun install
bun run dev      # http://localhost:5173
bun run build
bun run preview  # http://localhost:4173
```

## Not a workspace

This package installs its own `node_modules` and is deliberately absent from the
root `package.json` `workspaces`. Vocs pulls in `ajv-draft-04`, which needs
`ajv@8`; the monorepo root hoists `ajv@6` for ESLint, and the resulting
resolution breaks `vocs dev` with `Cannot find module 'ajv/dist/core'`. Isolating
the install avoids that without forcing an `ajv` override on every workspace.

Run `bun install` here before `bun run dev:docs` from the repo root.

## Why `bun run dev` is not `vocs dev`

`bun run dev` runs `scripts/dev.js`, a copy of the `vocs dev` command that
also pre-bundles `mermaid`. Under plain `vocs dev`, Mermaid diagrams show an
error box instead: `dayjs.min.js doesn't provide an export named 'default'`.
Vocs loads `mermaid` through a dynamic import inside `node_modules/vocs`, which
Vite's dependency optimizer skips, so its CommonJS dependency `dayjs` is served
raw. Vocs starts Vite with `configFile: false`, so the `optimizeDeps` override
has to live in our own server script. Production builds are unaffected. Return
to `vocs dev` once Vocs pre-bundles `mermaid` itself. Set `PORT` to change the
dev port.

## Why `waku` is pinned

`waku` is pinned to an exact `1.0.0-beta.8`. Waku removed `unstable_events` from
its router in `1.0.0-beta.9`, and Vocs 2.8.5 still calls it in
`ScrollRestoration`. Vocs declares `waku: ^1.0.0-beta.6`, so an unpinned install
resolves to a version without that API, `ScrollRestoration` throws during
hydration, React tears down the document, and every page renders blank with the
server HTML arriving intact. Unpin only once Vocs supports the newer router.
