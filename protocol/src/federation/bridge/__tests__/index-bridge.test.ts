import { describe, it, expect, jest } from 'bun:test';
import { IndexBridge } from '../index.bridge';

describe('IndexBridge', () => {
  const mockAdapter = {
    getIndexDetail: jest.fn(),
    getIndexMembers: jest.fn(),
    addMemberToIndex: jest.fn(),
  };

  const bridge = new IndexBridge(mockAdapter as any, 'https://my-node.com');

  it('converts internal index to federated format', async () => {
    mockAdapter.getIndexDetail.mockResolvedValueOnce({
      id: 'uuid-123',
      title: 'AI Founders',
      prompt: 'Looking for AI co-founders',
      permissions: { joinPolicy: 'anyone' },
      _count: { members: 5 },
    });

    const result = await bridge.getIndex('uuid-123');
    expect(result).toEqual({
      id: 'https://my-node.com/indexes/uuid-123',
      title: 'AI Founders',
      prompt: 'Looking for AI co-founders',
      permissions: { joinPolicy: 'anyone' },
      memberCount: 5,
      nodeUrl: 'https://my-node.com',
    });
  });
});
