import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect } from 'bun:test';
import {
  conversations, conversationParticipants, messages, tasks, artifacts, conversationMetadata,
  participantTypeEnum, messageRoleEnum, taskStateEnum,
} from '../conversation.schema';

describe('conversation schema', () => {
  it('exports all tables', () => {
    expect(conversations).toBeDefined();
    expect(conversationParticipants).toBeDefined();
    expect(messages).toBeDefined();
    expect(tasks).toBeDefined();
    expect(artifacts).toBeDefined();
    expect(conversationMetadata).toBeDefined();
  });

  it('exports all enums', () => {
    expect(participantTypeEnum.enumValues).toEqual(['user', 'agent']);
    expect(messageRoleEnum.enumValues).toEqual(['user', 'agent']);
    expect(taskStateEnum.enumValues).toEqual([
      'submitted', 'working', 'input_required', 'completed', 'failed', 'canceled', 'rejected', 'auth_required', 'waiting_for_agent', 'claimed',
    ]);
  });
});
