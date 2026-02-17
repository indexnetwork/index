import type { FederatedIndex } from '../spec/types';

export class IndexBridge {
  constructor(private adapter: any, private nodeUrl: string) {}

  async getIndex(indexId: string): Promise<FederatedIndex | null> {
    const index = await this.adapter.getIndexDetail(indexId);
    if (!index) return null;
    return {
      id: `${this.nodeUrl}/indexes/${index.id}`,
      title: index.title,
      prompt: index.prompt || null,
      permissions: index.permissions || null,
      memberCount: index._count?.members || 0,
      nodeUrl: this.nodeUrl,
    };
  }

  async joinIndex(indexId: string, actorUrl: string): Promise<{ membership: unknown }> {
    const membership = await this.adapter.addMemberToIndex(indexId, actorUrl, 'member');
    return { membership };
  }
}
