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

  /**
   * A2A negotiation turns persist as `[{ kind: 'data', data: turn }]` and carry
   * NO text part, so the text-part filter dropped every one of them — the
   * intent page's negotiations tab rendered "no agent conversations have
   * started yet" for every live negotiation, with the agent's prose sitting one
   * field down in `data.message`. Checked against the dev database at the time:
   * 18 of 18 agent messages were data parts, 0 had a text part.
   */
  it('projects negotiation turns, their action, and the checklist they carry', () => {
    const turn = (action: string, message: string, checklist?: unknown) => [{
      kind: 'data',
      data: {
        action,
        message,
        assessment: { reasoning: 'internal', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
        ...(checklist ? { checklist } : {}),
      },
    }];
    const checklist = [
      { name: 'Mutual want', kind: 'mutual_want', result: 'ok', basis: 'both intents say so' },
      { name: 'Weekday availability', kind: 'fit', result: 'unknown', basis: '' },
      { name: 'Skill level', kind: 'fit', result: 'unknown', basis: '' },
    ];

    const result = projectNegotiationActivity(
      'owner',
      [{ id: 'opp-a', status: 'negotiating', actors: [{ userId: 'owner' }, { userId: 'ada' }] }],
      new Map([['task-a', 'opp-a']]),
      [
        { id: 't1', taskId: 'task-a', senderId: 'agent:owner', parts: turn('outreach', 'Reaching out about climbing.', checklist), createdAt: date(1) },
        { id: 't2', taskId: 'task-a', senderId: 'agent:ada', parts: turn('question', 'Which grade and which evenings?'), createdAt: date(2) },
        { id: 't3', taskId: 'task-a', senderId: 'agent:owner', parts: turn('ask_user', 'Pausing to ask my client.'), createdAt: date(3) },
      ],
      new Map([['ada', { name: 'Ada', avatar: null }]]),
    );

    expect(result[0]?.messages.map((message) => message.action)).toEqual(['outreach', 'question', 'ask_user']);
    expect(result[0]?.messages.map((message) => message.text)).toEqual([
      'Reaching out about climbing.',
      'Which grade and which evenings?',
      'Pausing to ask my client.',
    ]);
    // The checklist rides on the FIRST turn here, outside the latest-three
    // window in longer negotiations — so it is derived from the whole record.
    expect(result[0]?.checklist).toEqual(checklist);
  });

  it('derives the checklist from the last turn that carried one, past the latest-three slice', () => {
    const turn = (action: string, message: string, checklist?: unknown) => [{
      kind: 'data',
      data: { action, message, assessment: { reasoning: 'r', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } }, ...(checklist ? { checklist } : {}) },
    }];
    const first = [{ name: 'Mutual want', kind: 'mutual_want', result: 'unknown', basis: '' }];
    const rescored = [{ name: 'Mutual want', kind: 'mutual_want', result: 'ok', basis: 'they said yes' }];

    const result = projectNegotiationActivity(
      'owner',
      [{ id: 'opp-a', status: 'negotiating', actors: [{ userId: 'owner' }, { userId: 'ada' }] }],
      new Map([['task-a', 'opp-a']]),
      [
        { id: 'm1', taskId: 'task-a', senderId: 'agent:owner', parts: turn('outreach', 'one', first), createdAt: date(1) },
        { id: 'm2', taskId: 'task-a', senderId: 'agent:ada', parts: turn('counter', 'two', rescored), createdAt: date(2) },
        { id: 'm3', taskId: 'task-a', senderId: 'agent:owner', parts: turn('counter', 'three'), createdAt: date(3) },
        { id: 'm4', taskId: 'task-a', senderId: 'agent:ada', parts: turn('accept', 'four'), createdAt: date(4) },
      ],
      new Map([['ada', { name: 'Ada', avatar: null }]]),
    );

    expect(result[0]?.messages.map((message) => message.id)).toEqual(['m2', 'm3', 'm4']);
    expect(result[0]?.checklist).toEqual(rescored);
  });
});
