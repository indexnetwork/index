// TODO: fix layering violation — controller should not import protocol directly
// eslint-disable-next-line boundaries/dependencies
import type { IntegrationAdapter } from '../lib/protocol/interfaces/integration.interface';
import type { IntegrationService } from '../services/integration.service';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Delete, Get, Post, UseGuards } from '../lib/router/router.decorators';

/** Server-side allowlist of supported Composio toolkits. */
const ALLOWED_TOOLKITS = ['gmail', 'slack'] as const;

type AllowedToolkit = typeof ALLOWED_TOOLKITS[number];

function isAllowedToolkit(t: string): t is AllowedToolkit {
  return ALLOWED_TOOLKITS.includes(t as AllowedToolkit);
}

/**
 * Manages external integration connections (OAuth), index-scoped linking, and contact import.
 * OAuth connections are user-level (Composio); the index_integrations table tracks
 * which connections are linked to which indexes.
 */
@Controller('/integrations')
export class IntegrationController {
  constructor(
    private adapter: IntegrationAdapter,
    private integrationService: IntegrationService,
  ) {}

  /**
   * List connected accounts for the authenticated user.
   * If ?indexId is provided, returns only connections linked to that index.
   * GET /api/integrations
   */
  @Get('')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url);
    const indexId = url.searchParams.get('indexId');

    const connections = await this.adapter.listConnections(user.id);

    if (indexId) {
      const linked = await this.integrationService.getLinkedIntegrations(user.id, indexId);
      const linkedToolkits = new Set(linked.map(l => l.toolkit));
      return {
        connections: connections.filter(c => linkedToolkits.has(c.toolkit)),
      };
    }

    return { connections };
  }

  /**
   * Start OAuth flow to connect a toolkit.
   * POST /api/integrations/connect/:toolkit
   */
  @Post('/connect/:toolkit')
  @UseGuards(AuthGuard)
  async connect(_req: Request, user: AuthenticatedUser, params: { toolkit: string }) {
    if (!isAllowedToolkit(params.toolkit)) {
      return new Response(JSON.stringify({ error: 'Unsupported toolkit' }), { status: 400 });
    }
    const baseUrl = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
    const callbackUrl = `${baseUrl}/oauth/callback`;
    const result = await this.adapter.getAuthUrl(user.id, params.toolkit, callbackUrl);
    return result;
  }

  /**
   * Link a toolkit to an index. If the user already has a Composio connection
   * for this toolkit, records the mapping. Otherwise returns 400.
   * POST /api/integrations/:toolkit/link
   * Body: { indexId: string }
   */
  @Post('/:toolkit/link')
  @UseGuards(AuthGuard)
  async link(req: Request, user: AuthenticatedUser, params: { toolkit: string }) {
    if (!isAllowedToolkit(params.toolkit)) {
      return new Response(JSON.stringify({ error: 'Unsupported toolkit' }), { status: 400 });
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const indexId = typeof body.indexId === 'string' ? body.indexId : undefined;
    if (!indexId) {
      return new Response(JSON.stringify({ error: 'indexId is required' }), { status: 400 });
    }
    try {
      await this.integrationService.linkToIndex(user.id, params.toolkit, indexId);
      return { success: true };
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Link failed' }), { status: 400 });
    }
  }

  /**
   * Unlink a toolkit from an index. Does NOT revoke the Composio OAuth connection.
   * DELETE /api/integrations/:toolkit/link?indexId=X
   */
  @Delete('/:toolkit/link')
  @UseGuards(AuthGuard)
  async unlink(req: Request, user: AuthenticatedUser, params: { toolkit: string }) {
    if (!isAllowedToolkit(params.toolkit)) {
      return new Response(JSON.stringify({ error: 'Unsupported toolkit' }), { status: 400 });
    }
    const url = new URL(req.url);
    const indexId = url.searchParams.get('indexId');
    if (!indexId) {
      return new Response(JSON.stringify({ error: 'indexId query param is required' }), { status: 400 });
    }
    try {
      await this.integrationService.unlinkFromIndex(user.id, params.toolkit, indexId);
      return { success: true };
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unlink failed' }), { status: 400 });
    }
  }

  /**
   * Import contacts from a connected toolkit into an index.
   * Personal indexes receive contacts with 'contact' permission;
   * non-personal indexes receive members with 'member' permission.
   * POST /api/integrations/:toolkit/import
   */
  @Post('/:toolkit/import')
  @UseGuards(AuthGuard)
  async importContacts(req: Request, user: AuthenticatedUser, params: { toolkit: string }) {
    if (!isAllowedToolkit(params.toolkit)) {
      return new Response(JSON.stringify({ error: 'Unsupported toolkit' }), { status: 400 });
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const indexId = typeof body.indexId === 'string' ? body.indexId : undefined;
    try {
      const result = await this.integrationService.importContacts(user.id, params.toolkit, indexId);
      return result;
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Import failed' }), { status: 400 });
    }
  }

  /**
   * Disconnect (delete) a connected Composio account.
   * Also removes all index_integrations rows for this connection.
   * DELETE /api/integrations/:id
   */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async disconnect(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const connections = await this.adapter.listConnections(user.id);
    const conn = connections.find((c) => c.id === params.id);
    if (!conn) {
      return new Response(JSON.stringify({ error: 'Connection not found' }), { status: 404 });
    }
    await this.integrationService.cleanupConnectionLinks(conn.id);
    const result = await this.adapter.disconnect(conn.id);
    return result;
  }
}
