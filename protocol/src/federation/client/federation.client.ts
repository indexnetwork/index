import { log } from '../../lib/log';
import type {
  WellKnownResponse,
  PushIntentRequest,
  QueryIndexRequest,
  QueryIndexResponse,
  ChatMessage,
  JoinIndexRequest,
  FederatedUser,
  FederatedIndex,
} from '../spec/types';

const logger = log.lib.from('FederationClient');

interface FederationClientConfig {
  localBaseUrl: string;
  privateKeyPem: string;
  keyId: string;
}

export class FederationClient {
  constructor(private config: FederationClientConfig) {}

  async discoverNode(nodeBaseUrl: string): Promise<WellKnownResponse> {
    const url = `${nodeBaseUrl}/.well-known/index-protocol`;
    logger.info('Discovering node', { url });
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Discovery failed for ${nodeBaseUrl}: ${res.status}`);
    return res.json();
  }

  async getUser(userUrl: string): Promise<FederatedUser> {
    const res = await fetch(userUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`Failed to fetch user ${userUrl}: ${res.status}`);
    return res.json();
  }

  async getIndex(indexUrl: string): Promise<FederatedIndex> {
    const res = await fetch(indexUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`Failed to fetch index ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async joinIndex(indexUrl: string, request: JoinIndexRequest): Promise<{ membership: unknown }> {
    const url = `${indexUrl}/members`;
    const body = JSON.stringify(request);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Join index failed for ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async pushIntent(indexUrl: string, request: PushIntentRequest): Promise<{ intentUrl: string }> {
    const url = `${indexUrl}/intents`;
    const body = JSON.stringify(request);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Push intent failed for ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async queryIndex(indexUrl: string, request: QueryIndexRequest): Promise<QueryIndexResponse> {
    const url = `${indexUrl}/query`;
    const body = JSON.stringify(request);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Query failed for ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async sendChatMessage(targetNodeUrl: string, message: ChatMessage): Promise<void> {
    const url = `${targetNodeUrl}/inbox`;
    const body = JSON.stringify(message);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Chat message failed to ${targetNodeUrl}: ${res.status}`);
  }
}
