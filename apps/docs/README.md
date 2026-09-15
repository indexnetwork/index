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

## Mermaid diagrams do not render under `vocs dev`

The pipeline diagram on the overview page renders correctly in `bun run build`
and `bun run preview`, but `vocs dev` shows an error box in its place:
`dayjs.min.js does not provide an export named 'default'`. Vocs loads `mermaid`
through a dynamic import inside `node_modules`, so Vite's dependency optimizer
never pre-bundles `dayjs` and serves it raw. Vocs starts Vite with
`configFile: false`, so there is no supported way to add an `optimizeDeps`
override. Check diagrams with `bun run preview`.

## Why `waku` is pinned

`waku` is pinned to an exact `1.0.0-beta.8`. Waku removed `unstable_events` from
its router in `1.0.0-beta.9`, and Vocs 2.8.5 still calls it in
`ScrollRestoration`. Vocs declares `waku: ^1.0.0-beta.6`, so an unpinned install
resolves to a version without that API, `ScrollRestoration` throws during
hydration, React tears down the document, and every page renders blank with the
server HTML arriving intact. Unpin only once Vocs supports the newer router.
