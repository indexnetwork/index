/** Serve the built client with an SPA fallback. `PORT` defaults to 3000. */
import { join } from 'node:path';

const root = join(import.meta.dir, 'dist');
const index = Bun.file(join(root, 'index.html'));

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return new Response('ok');
    const file = Bun.file(join(root, pathname));
    if (!pathname.includes('..') && pathname !== '/' && await file.exists()) {
      const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      return new Response(file, { headers: { 'Cache-Control': cache } });
    }
    return new Response(index, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
  },
});
console.log(`[nostr-web] serving ${root} on :${process.env.PORT ?? 3000}`);
