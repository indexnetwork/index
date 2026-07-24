import { describe, expect, it } from 'bun:test';

import { projectNegotiationActivity } from '../negotiation-activity';

const date = (second: number) => new Date(`2026-07-24T00:00:0${second}.000Z`);

describe('projectNegotiationActivity', () => {
  it('isolates exact task/opportunity mappings, groups correspondents, and keeps latest three chronologically', () => {
    const result = projectNegotiationActivity(
      'owner',
      [
        { id: 'opp-a', actors: [{ userId: 'owner' }, { userId: 'ada' }] },
        { id: 'opp-b', actors: [{ userId: 'owner' }, { userId: 'bob' }] },
      ],
      new Map([['task-a', 'opp-a'], ['task-b', 'opp-b'], ['foreign-task', 'foreign-opp']]),
      [
        { id: 'a4', taskId: 'task-a', senderId: 'agent:ada', parts: ['four'], createdAt: date(4) },
        { id: 'foreign', taskId: 'foreign-task', senderId: 'agent:other', parts: ['secret'], createdAt: date(5) },
        { id: 'a1', taskId: 'task-a', senderId: 'agent:owner', parts: ['one'], createdAt: date(1) },
        { id: 'b1', taskId: 'task-b', senderId: 'agent:bob', parts: ['bob'], createdAt: date(1) },
        { id: 'a3', taskId: 'task-a', senderId: 'agent:ada', parts: ['three'], createdAt: date(3) },
        { id: 'a2', taskId: 'task-a', senderId: 'agent:owner', parts: ['two'], createdAt: date(2) },
      ],
      new Map([
        ['ada', { name: 'Ada', avatar: null }],
        ['bob', { name: 'Bob', avatar: null }],
      ]),
    );

    expect(result.map((group) => group.correspondentUserId)).toEqual(['ada', 'bob']);
    expect(result[0]?.messages.map((message) => message.id)).toEqual(['a2', 'a3', 'a4']);
    expect(result[0]?.messages.map((message) => message.sender)).toEqual(['yours', 'theirs', 'theirs']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
