import type { FederatedIntent, PushIntentRequest } from '../spec/types';

export class IntentBridge {
  constructor(private adapter: any, private nodeUrl: string) {}

  async pushIntent(indexId: string, request: PushIntentRequest): Promise<{ intentUrl: string }> {
    const created = await this.adapter.createIntent({
      userId: request.actor,
      payload: request.payload,
      embedding: request.embedding,
      sourceType: 'enrichment',
    });
    await this.adapter.assignIntentToIndex(created.id, indexId);
    return { intentUrl: `${this.nodeUrl}/indexes/${indexId}/intents/${created.id}` };
  }

  async queryIndex(indexId: string, embedding: number[], limit: number, filters: Record<string, unknown>): Promise<FederatedIntent[]> {
    const results = await this.adapter.vectorSearchInIndex(indexId, embedding, limit, filters);
    return results.map((r: any) => ({
      intentUrl: `${this.nodeUrl}/indexes/${indexId}/intents/${r.id}`,
      payload: r.payload,
      embedding: r.embedding,
      similarity: r.similarity,
      userId: `${this.nodeUrl}/users/${r.userId}`,
    }));
  }
}
