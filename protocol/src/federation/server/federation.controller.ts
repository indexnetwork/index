import { Controller, Get, Post, Put, Delete } from '../../lib/router/router.decorators';
import { log } from '../../lib/log';
import type { IndexBridge } from '../bridge/index.bridge';
import type { UserBridge } from '../bridge/user.bridge';
import type { IntentBridge } from '../bridge/intent.bridge';
import type { ChatBridge } from '../bridge/chat.bridge';
import {
  PushIntentRequestSchema,
  QueryIndexRequestSchema,
  JoinIndexRequestSchema,
  ChatMessageSchema,
  UpdateIntentRequestSchema,
} from '../spec/types';

const logger = log.controller.from('federation');

interface FederationControllerConfig {
  nodeUrl: string;
  version: string;
  name: string;
  publicKeyPem: string;
  indexBridge: IndexBridge;
  userBridge: UserBridge;
  intentBridge: IntentBridge;
  chatBridge: ChatBridge;
}

@Controller('/federation')
export class FederationController {
  private config: FederationControllerConfig;

  constructor(config: FederationControllerConfig) {
    this.config = config;
  }

  @Get('/.well-known')
  async wellKnown(_req: Request) {
    return Response.json({
      version: this.config.version,
      name: this.config.name,
      baseUrl: this.config.nodeUrl,
      endpoints: {
        users: '/federation/users',
        indexes: '/federation/indexes',
        inbox: '/federation/inbox',
      },
      publicKey: {
        id: `${this.config.nodeUrl}#main-key`,
        pem: this.config.publicKeyPem,
      },
    });
  }

  @Get('/users/:id')
  async getUser(_req: Request, _guard: unknown, params: Record<string, string>) {
    const user = await this.config.userBridge.getUser(params.id);
    if (!user) return Response.json({ error: 'User not found' }, { status: 404 });
    return Response.json(user);
  }

  @Get('/indexes/:id')
  async getIndex(_req: Request, _guard: unknown, params: Record<string, string>) {
    const index = await this.config.indexBridge.getIndex(params.id);
    if (!index) return Response.json({ error: 'Index not found' }, { status: 404 });
    return Response.json(index);
  }

  @Post('/indexes/:id/members')
  async joinIndex(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = JoinIndexRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    try {
      const result = await this.config.indexBridge.joinIndex(params.id, parsed.data.actor);
      return Response.json(result, { status: 201 });
    } catch (err: any) {
      logger.warn('Join index failed', { indexId: params.id, error: err.message });
      return Response.json({ error: err.message }, { status: 403 });
    }
  }

  @Post('/indexes/:id/intents')
  async pushIntent(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = PushIntentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    const result = await this.config.intentBridge.pushIntent(params.id, parsed.data);
    logger.info('Intent pushed', { indexId: params.id, actor: parsed.data.actor });
    return Response.json(result, { status: 201 });
  }

  @Put('/indexes/:id/intents/:intentId')
  async updateIntent(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = UpdateIntentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
    // TODO: delegate to intentBridge.updateIntent
    return Response.json({ updated: true });
  }

  @Delete('/indexes/:id/intents/:intentId')
  async deleteIntent(_req: Request, _guard: unknown, params: Record<string, string>) {
    // TODO: delegate to intentBridge.deleteIntent
    return Response.json({ deleted: true });
  }

  @Post('/indexes/:id/query')
  async queryIndex(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = QueryIndexRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    const results = await this.config.intentBridge.queryIndex(
      params.id,
      parsed.data.embedding,
      parsed.data.limit,
      parsed.data.filters
    );
    return Response.json({ results });
  }

  @Post('/inbox')
  async inbox(req: Request) {
    const body = await req.json().catch(() => null);
    const parsed = ChatMessageSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    await this.config.chatBridge.receiveMessage(parsed.data);
    logger.info('Chat message received', { from: parsed.data.from, to: parsed.data.to });
    return new Response(null, { status: 202 });
  }
}
