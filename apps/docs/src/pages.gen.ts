// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages } from 'waku/router'

// prettier-ignore
type Page =
  | { path: '/discovery'; render: 'static' }
  | { path: '/guides/custom-negotiator'; render: 'static' }
  | { path: '/guides/find-someone'; render: 'static' }
  | { path: '/guides/introducer-agent'; render: 'static' }
  | { path: '/'; render: 'static' }
  | { path: '/integrate/host'; render: 'static' }
  | { path: '/integrate/rest'; render: 'static' }
  | { path: '/integrate/stability'; render: 'static' }
  | { path: '/intent'; render: 'static' }
  | { path: '/negotiation'; render: 'static' }
  | { path: '/network'; render: 'static' }
  | { path: '/opportunity'; render: 'static' }
  | { path: '/privacy'; render: 'static' }
  | { path: '/use/cli'; render: 'static' }
  | { path: '/use/hermes'; render: 'static' }
  | { path: '/use/mac'; render: 'static' }
  | { path: '/use/mcp'; render: 'static' }
  | { path: '/use/personal-agent'; render: 'static' }

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>
  }
  interface CreatePagesConfig {
    pages: Page
  }
}
