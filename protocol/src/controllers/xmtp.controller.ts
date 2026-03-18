import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import type { XmtpService } from '../services/xmtp.service';
import { log } from '../lib/log';

const logger = log.controller.from('xmtp');

/**
 * Manages XMTP key retrieval, peer resolution, and conversation management.
 */
@Controller('/xmtp/keys')
export class XmtpController {
  constructor(private readonly xmtpService: XmtpService) {}

  /**
   * GET /xmtp/keys/wallet — return the decrypted wallet key for the authenticated user.
   * @param user - Authenticated user from AuthGuard.
   * @returns Wallet private key and address, or 404 if no wallet exists.
   */
  @Get('/wallet')
  @UseGuards(AuthGuard)
  async getWalletKey(_req: Request, user: AuthenticatedUser) {
    try {
      const result = await this.xmtpService.getWalletKey(user.id);
      if (!result) {
        return Response.json({ error: 'No wallet found' }, { status: 404 });
      }
      return Response.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[getWalletKey] Error', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /xmtp/keys/peer-info — get public XMTP identity for a user.
   * @param req - Must include `userId` in JSON body.
   * @param user - Authenticated user from AuthGuard.
   */
  @Post('/peer-info')
  @UseGuards(AuthGuard)
  async getPeerInfo(req: Request, _user: AuthenticatedUser) {
    let body: { userId?: string };
    try {
      body = (await req.json()) as { userId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.userId) {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }

    try {
      const info = await this.xmtpService.getPeerInfo(body.userId);
      if (!info) {
        return Response.json({ error: 'User not found' }, { status: 404 });
      }
      return Response.json(info);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[getPeerInfo] Error', { error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /xmtp/keys/resolve-peers — batch resolve XMTP inbox IDs to user info.
   * @param req - Must include `inboxIds` string array in JSON body.
   * @param user - Authenticated user from AuthGuard.
   */
  @Post('/resolve-peers')
  @UseGuards(AuthGuard)
  async resolvePeers(req: Request, _user: AuthenticatedUser) {
    let body: { inboxIds?: string[] };
    try {
      body = (await req.json()) as { inboxIds?: string[] };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.inboxIds || !Array.isArray(body.inboxIds) || body.inboxIds.length === 0) {
      return Response.json({ error: 'inboxIds array is required' }, { status: 400 });
    }

    try {
      const peers = await this.xmtpService.resolvePeers(body.inboxIds);
      return Response.json({ peers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[resolvePeers] Error', { error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * POST /xmtp/keys/hide-conversation — soft-delete a conversation.
   * @param req - Must include `conversationId` in JSON body.
   * @param user - Authenticated user from AuthGuard.
   */
  @Post('/hide-conversation')
  @UseGuards(AuthGuard)
  async hideConversation(req: Request, user: AuthenticatedUser) {
    let body: { conversationId?: string };
    try {
      body = (await req.json()) as { conversationId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.conversationId) {
      return Response.json({ error: 'conversationId is required' }, { status: 400 });
    }

    try {
      await this.xmtpService.hideConversation(user.id, body.conversationId);
      return Response.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[hideConversation] Error', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * GET /xmtp/keys/hidden-conversations — list hidden conversations for the user.
   * @param user - Authenticated user from AuthGuard.
   */
  @Get('/hidden-conversations')
  @UseGuards(AuthGuard)
  async getHiddenConversations(_req: Request, user: AuthenticatedUser) {
    try {
      const conversations = await this.xmtpService.getHiddenConversations(user.id);
      return Response.json({ conversations });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[getHiddenConversations] Error', { userId: user.id, error: message });
      return Response.json({ error: message }, { status: 500 });
    }
  }
}
