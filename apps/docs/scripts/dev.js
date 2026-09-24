// Development server for the docs site.
//
// Mirrors `vocs dev` (vocs/dist/cli.js), which starts Vite with
// `configFile: false` and offers no way to extend its config. The only
// addition is pre-bundling `mermaid`: Vocs loads it through a dynamic import
// inside `node_modules/vocs`, which Vite's dependency scanner skips, so its
// CommonJS dependency `dayjs` would otherwise be served raw and fail with
// "doesn't provide an export named: 'default'".
import react from '@vitejs/plugin-react'
import * as vite from 'vite'
import { vocs } from 'vocs/vite'

const port = Number(process.env.PORT) || 5173

const server = await vite.createServer({
  configFile: false,
  plugins: [react(), vocs()],
  optimizeDeps: {
    include: ['mermaid'],
  },
  server: { port },
})

await server.listen()
server.printUrls()
