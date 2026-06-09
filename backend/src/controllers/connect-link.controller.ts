import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { resolveConnectLinkForUser } from '../services/connect-link.service';
import { opportunityService } from '../services/opportunity.service';

/** Route params when path has :code */
type RouteParams = Record<string, string>;

type ConnectLinkGoResponse =
  | { url: string }
  | { kind: 'approve_introduction' };

const CODE_PATTERN = /^[A-Za-z0-9]{10}$/;

const EXPIRED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unavailable</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">This opportunity is no longer available</h1>
<p style="color:#666">The opportunity behind this link has expired or been closed.</p>
</div></body></html>`;

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network').replace(/\/+$/, '');
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFoundJson(): Response {
  return jsonError('Link not found', 404);
}

/**
 * ConnectLinkController: opaque short-link dispatcher.
 *
 * Public `/c/:code` is only a bridge into the frontend continuation route. It
 * deliberately does not resolve `connect_links` rows: account binding happens
 * on authenticated `/c/:code/go`, where the JWT user must match the stored
 * recipient before any opportunity side effect or destination lookup runs.
 */
@Controller('/c')
export class ConnectLinkController {
  /**
   * GET /c/:code — public short-link bridge.
   *
   * Valid-looking short codes are redirected to the frontend continuation route
   * with the same opaque code. The frontend preserves that URL through login and
   * calls authenticated `/api/c/:code/go`. This route performs no DB lookup and
   * no opportunity side effects.
   */
  @Get('/:code')
  @UseGuards(RateLimit('read'))
  async resolve(_req: Request, _user: unknown, params?: RouteParams) {
    const code = params?.code;
    if (!code) return new Response('Missing code', { status: 400 });

    if (!CODE_PATTERN.test(code)) {
      return new Response(EXPIRED_HTML, { status: 404, headers: { 'Content-Type': 'text/html' } });
    }

    return Response.redirect(`${getFrontendUrl()}/c/${code}`, 302);
  }

  /**
   * GET /c/:code/go — authenticated JSON resolver.
   *
   * Resolves the short code, verifies the authenticated user is the stored
   * recipient, then performs the kind-specific side effect and returns the final
   * destination. Unknown, terminal, malformed, and wrong-account links are all
   * masked as 404. No greeting generation, DM lookup, approval, or acceptance
   * runs until the recipient check passes.
   */
  @Get('/:code/go')
  @UseGuards(RateLimit('read'), AuthGuard)
  async go(_req: Request, user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const code = params?.code;
    if (!code) return jsonError('Missing code', 400);
    if (!CODE_PATTERN.test(code)) return notFoundJson();

    const link = await resolveConnectLinkForUser(code, user.id);
    if (!link) return notFoundJson();

    const frontendUrl = getFrontendUrl();
    const greetingForRecipient = async () => (
      link.greeting ?? (await opportunityService.getGreetingForCard(link.opportunityId, user.id))
    );

    if (link.kind === 'approve_introduction') {
      const result = await opportunityService.approveIntroduction(link.opportunityId, user.id);
      if ('error' in result) return jsonError(result.error, result.status);
      return Response.json({ kind: 'approve_introduction' } satisfies ConnectLinkGoResponse);
    }

    // `connect` (receiver flipping pending → accepted) and `send_direct`
    // (sender flipping draft/latent → accepted) both want the chat open and the
    // greeting ready to send. opportunityService.startChat handles both source
    // statuses; the semantic difference lives in the matrix that picked `kind`.
    if (link.kind === 'connect' || link.kind === 'send_direct') {
      const greeting = await greetingForRecipient();
      const result = await opportunityService.startChat(link.opportunityId, user.id);
      if ('error' in result) return jsonError(result.error, result.status);

      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandle(result.counterpartUserId);
        const target = handle
          ? (greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`)
          : (greeting
              ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
              : `${frontendUrl}/u/${result.counterpartUserId}/chat`);
        return Response.json({ url: target } satisfies ConnectLinkGoResponse);
      }

      const target = greeting
        ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
        : `${frontendUrl}/u/${result.counterpartUserId}/chat`;
      return Response.json({ url: target } satisfies ConnectLinkGoResponse);
    }

    if (link.kind === 'outreach') {
      const greeting = await greetingForRecipient();

      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandleForOpp(link.opportunityId, user.id);
        if (handle) {
          const target = greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`;
          return Response.json({ url: target } satisfies ConnectLinkGoResponse);
        }
      }
      const conversationId = await opportunityService.getConversationIdForOpp(link.opportunityId, user.id);
      const target = conversationId
        ? `${frontendUrl}/conversations/${conversationId}${greeting ? `?msg=${encodeURIComponent(greeting)}` : ''}`
        : frontendUrl;
      return Response.json({ url: target } satisfies ConnectLinkGoResponse);
    }

    return jsonError('Unknown link kind', 400);
  }
}
