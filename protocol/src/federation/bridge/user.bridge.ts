import type { FederatedUser } from '../spec/types';

export class UserBridge {
  constructor(private adapter: any, private nodeUrl: string) {}

  async getUser(userId: string): Promise<FederatedUser | null> {
    const user = await this.adapter.getUserWithProfile(userId);
    if (!user) return null;
    return {
      id: `${this.nodeUrl}/users/${user.id}`,
      name: user.name,
      avatar: user.avatar || null,
      narrative: user.profile?.narrative?.context || null,
      attributes: user.profile?.attributes || null,
      nodeUrl: this.nodeUrl,
    };
  }
}
