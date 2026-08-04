import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';

/** Route params when path has :code */
type RouteParams = Record<string, string>;

const CODE_PATTERN = /^[A-Za-z0-9]{10}$/;

const EXPIRED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unavailable</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">This opportunity is no longer available</h1>
<p style="color:#666">The opportunity behind this link has expired or been closed.</p>
</div></body></html>`;

function getFrontendUrl(): string {
  return (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');
}

/** The request's query string (`?a=b`), or '' when there is none or the URL is unparseable. */
export function safeSearch(requestUrl: string): string {
  try {
    return new URL(requestUrl).search;
  } catch {
    return '';
  }
}

/**
 * ConnectLinkController: tombstone short-link bridge.
 *
 * Connect links and their resolution stack (minting, recipient binding,
 * opportunity side effects, surface routing) have been removed. `GET /c/:code`
 * survives only as a public bridge so links already delivered in chats still
 * land somewhere sensible: valid-looking codes redirect to the frontend
 * continuation route (a static landing page), malformed codes get the expired
 * page. This route performs NO database lookup and no opportunity side effects.
 */
@Controller('/c')
export class ConnectLinkController {
  /**
   * GET /c/:code — public short-link bridge.
   *
   * Valid-looking short codes are redirected to the frontend continuation route
   * with the same opaque code and query string. No DB lookup, no recipient
   * binding, no side effects — the resolution stack behind `/c/:code/go` is
   * deleted.
   */
  @Get('/:code')
  @UseGuards(RateLimit('read'))
  async resolve(req: Request, _user: unknown, params?: RouteParams) {
    const code = params?.code;
    if (!code) return new Response('Missing code', { status: 400 });

    if (!CODE_PATTERN.test(code)) {
      return new Response(EXPIRED_HTML, { status: 404, headers: { 'Content-Type': 'text/html' } });
    }

    // Carry the query string over: already-delivered links append
    // `?link_preview=false`, and dropping it makes chat clients render preview
    // cards where the sender suppressed them.
    const search = safeSearch(req.url);

    return Response.redirect(`${getFrontendUrl()}/c/${code}${search}`, 302);
  }
}
