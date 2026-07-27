import { describe, expect, it } from 'bun:test';

import { projectNegotiationActivity } from '../negotiation-activity';

const date = (second: number) => new Date(`2026-07-24T00:00:0${second}.000Z`);

describe('projectNegotiationActivity', () => {
  it('isolates exact task/opportunity mappings, groups correspondents, and keeps latest three chronologically', () => {
    const result = projectNegotiationActivity(
      'owner',
      [
        { id: 'opp-a', status: 'negotiating', actors: [{ userId: 'owner' }, { userId: 'ada' }] },
        { id: 'opp-b', status: 'negotiating', actors: [{ userId: 'owner' }, { userId: 'bob' }] },
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

  it('excludes resolved opportunities and filters non-displayable turns before taking the latest three', () => {
    const result = projectNegotiationActivity(
      'owner',
      [
        { id: 'active', status: 'negotiating', actors: [{ userId: 'owner' }, { userId: 'ada' }] },
        { id: 'resolved', status: 'accepted', actors: [{ userId: 'owner' }, { userId: 'bob' }] },
        { id: 'empty', status: 'negotiating', actors: [{ userId: 'owner' }, { userId: 'eve' }] },
      ],
      new Map([
        ['task-active', 'active'],
        ['task-resolved', 'resolved'],
        ['task-empty', 'empty'],
      ]),
      [
        { id: 'a1', taskId: 'task-active', senderId: 'agent:owner', parts: [{ text: 'one' }], createdAt: date(1) },
        { id: 'a2', taskId: 'task-active', senderId: 'agent:ada', parts: [{ text: 'two' }], createdAt: date(2) },
        { id: 'tool', taskId: 'task-active', senderId: 'agent:ada', parts: [{ type: 'tool-call' }], createdAt: date(3) },
        { id: 'user', taskId: 'task-active', senderId: 'owner', parts: [{ text: 'not an agent turn' }], createdAt: date(4) },
        { id: 'a5', taskId: 'task-active', senderId: 'agent:owner', parts: ['five'], createdAt: date(5) },
        { id: 'a6', taskId: 'task-active', senderId: 'agent:ada', parts: [{ text: 'six' }], createdAt: date(6) },
        { id: 'resolved-message', taskId: 'task-resolved', senderId: 'agent:bob', parts: ['resolved'], createdAt: date(6) },
        { id: 'empty-message', taskId: 'task-empty', senderId: 'agent:eve', parts: [{ type: 'tool-call' }], createdAt: date(6) },
      ],
      new Map([
        ['ada', { name: 'Ada', avatar: null }],
        ['bob', { name: 'Bob', avatar: null }],
        ['eve', { name: 'Eve', avatar: null }],
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.correspondentUserId).toBe('ada');
    expect(result[0]?.messages.map((message) => message.id)).toEqual(['a2', 'a5', 'a6']);
  });
});
