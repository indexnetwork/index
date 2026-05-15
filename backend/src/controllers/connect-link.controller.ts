import { Controller, Get } from '../lib/router/router.decorators';
import { resolveConnectLink } from '../services/connect-link.service';
import { opportunityService } from '../services/opportunity.service';

/** Route params when path has :code */
type RouteParams = Record<string, string>;

const EXPIRED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Link Expired</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">This link has expired</h1>
<p style="color:#666">Connect links are valid for 30 days. Check your latest notification for a fresh link.</p>
</div></body></html>`;

const APPROVED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Introduction Approved</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">Introduction approved</h1>
<p style="color:#666">You approved the introduction. Both parties will be connected shortly.</p>
</div></body></html>`;

// Connect/outreach flows trigger an inline LLM call to generate a personalized
// greeting (see opportunityService.getGreetingForCard). That call has a 20s
// timeout and the user otherwise stares at a blank tab while it runs. Serve
// this interstitial immediately, then fetch the resolved URL via /c/:code/go
// and redirect client-side so the wait is visible.
const INTERSTITIAL_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connecting…</title><meta name="robots" content="noindex"></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#333">
<div id="state" style="text-align:center">
<div style="display:inline-block;width:32px;height:32px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite"></div>
<h1 style="font-size:1.25rem;margin:1rem 0 0.5rem">Connecting…</h1>
<p style="color:#666;margin:0">Preparing your message. This usually takes a few seconds.</p>
</div>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
<script>
(async()=>{
  const fail = (h)=>{document.getElementById('state').innerHTML=h};
  try {
    const r = await fetch(window.location.pathname.replace(/\\/$/, '') + '/go', { credentials: 'omit' });
    if (!r.ok) return fail('<h1 style="font-size:1.25rem">Could not open conversation</h1><p style="color:#666">Please try again, or contact support if this keeps happening.</p>');
    const j = await r.json();
    if (j.url) window.location.replace(j.url);
    else fail('<h1 style="font-size:1.25rem">Done</h1><p style="color:#666">You can close this tab.</p>');
  } catch (e) {
    fail('<h1 style="font-size:1.25rem">Connection failed</h1><p style="color:#666">Please try again.</p>');
  }
})();
</script>
</body></html>`;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * ConnectLinkController: opaque short-link dispatcher.
 *
 * Resolves a base62 short code minted by `connect-link.service.ts` and performs
 * the kind-appropriate side effect: `connect` accepts the opportunity and
 * redirects to Telegram (or web chat); `approve_introduction` flips the
 * introducer's approved flag and renders an inline HTML confirmation;
 * `outreach` redirects to a Telegram DM (or fallback chat URL) for an
 * already-accepted opportunity. Greeting is pulled from the connect-link row
 * and URI-encoded into the redirect target.
 *
 * No guard: authentication is via possession of the short code itself.
 */
@Controller('/c')
export class ConnectLinkController {
  /**
   * GET /c/:code — opaque short-link dispatcher.
   *
   * Browser entry point. For approve_introduction (synchronous-light, no LLM)
   * we do the work inline and return the confirmation HTML. For connect and
   * outreach (which trigger a 20s-tail LLM greeting call inside
   * getGreetingForCard), we return an interstitial HTML page that fetches
   * `/c/:code/go` and redirects client-side — the user sees a loading state
   * instead of a blank tab while the LLM runs.
   *
   * @param _req - The incoming request (unused; code is in path params).
   * @param _user - Unauthenticated route; no user context.
   * @param params - Path params, must contain `code`.
   * @returns Interstitial HTML 200 for connect/outreach; confirmation HTML 200
   *   for approve_introduction; expired HTML 404 if the code is unknown.
   */
  @Get('/:code')
  async resolve(_req: Request, _user: unknown, params?: RouteParams) {
    const code = params?.code;
    if (!code) return new Response('Missing code', { status: 400 });

    // Codes are 10-char base62 by construction (see connect-link.service.ts).
    // Reject malformed codes before hitting the DB to avoid wasted lookups
    // and make brute-force scanning more expensive.
    if (!/^[A-Za-z0-9]{10}$/.test(code)) {
      return new Response(EXPIRED_HTML, { status: 404, headers: { 'Content-Type': 'text/html' } });
    }

    const link = await resolveConnectLink(code);
    if (!link) {
      return new Response(EXPIRED_HTML, { status: 404, headers: { 'Content-Type': 'text/html' } });
    }

    if (link.kind === 'approve_introduction') {
      const result = await opportunityService.approveIntroduction(link.opportunityId, link.userId);
      if ('error' in result) {
        return new Response(result.error, { status: result.status });
      }
      return new Response(APPROVED_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    return new Response(INTERSTITIAL_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  /**
   * GET /c/:code/go — JSON resolver invoked by the interstitial HTML.
   *
   * Does the side-effecting work (resolve, optionally startChat, generate
   * greeting via LLM, look up Telegram handle / conversation) and returns the
   * final redirect URL as JSON. The client-side script in INTERSTITIAL_HTML
   * calls this endpoint and `location.replace`s on success.
   *
   * @returns `{ url: string }` for connect/outreach success; `{ error }` with
   *   appropriate status for any failure path. approve_introduction is handled
   *   inline on `/c/:code`; if this endpoint receives one, it executes the
   *   approval and returns `{ kind: 'approve_introduction' }` for completeness.
   */
  @Get('/:code/go')
  async go(_req: Request, _user: unknown, params?: RouteParams) {
    const code = params?.code;
    if (!code) return jsonError('Missing code', 400);
    if (!/^[A-Za-z0-9]{10}$/.test(code)) return jsonError('Invalid code', 404);

    const link = await resolveConnectLink(code);
    if (!link) return jsonError('Link expired', 404);

    const frontendUrl = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network').replace(/\/+$/, '');
    const greeting = link.greeting
      ?? (await opportunityService.getGreetingForCard(link.opportunityId, link.userId));

    if (link.kind === 'connect') {
      const result = await opportunityService.startChat(link.opportunityId, link.userId);
      if ('error' in result) return jsonError(result.error, result.status);

      // Receiver surface determines redirect target. preferredSurface = 'telegram'
      // means the click came from a Telegram-rendering MCP client (EdgeClaw) and
      // we should attempt the t.me deep link. Anything else (including NULL on
      // pre-rollout rows) goes to the web frontend.
      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandle(result.counterpartUserId);
        const target = handle
          ? (greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`)
          : (greeting
              ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
              : `${frontendUrl}/u/${result.counterpartUserId}/chat`);
        return Response.json({ url: target });
      }

      const target = greeting
        ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
        : `${frontendUrl}/u/${result.counterpartUserId}/chat`;
      return Response.json({ url: target });
    }

    if (link.kind === 'outreach') {
      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandleForOpp(link.opportunityId, link.userId);
        if (handle) {
          const target = greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`;
          return Response.json({ url: target });
        }
      }
      const conversationId = await opportunityService.getConversationIdForOpp(link.opportunityId, link.userId);
      const target = conversationId
        ? `${frontendUrl}/conversations/${conversationId}${greeting ? `?msg=${encodeURIComponent(greeting)}` : ''}`
        : frontendUrl;
      return Response.json({ url: target });
    }

    if (link.kind === 'approve_introduction') {
      const result = await opportunityService.approveIntroduction(link.opportunityId, link.userId);
      if ('error' in result) return jsonError(result.error, result.status);
      return Response.json({ kind: 'approve_introduction' });
    }

    return jsonError('Unknown link kind', 400);
  }
}
