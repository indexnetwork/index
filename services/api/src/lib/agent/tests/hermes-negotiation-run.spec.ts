import { describe, expect, it } from 'bun:test';

import { HERMES_RUN_CAPABILITY_TTL_MS, issueHermesRunCapability, verifyHermesRunCapability, type HermesRunCapabilityBinding } from '../hermes-negotiation-run';

const principal = {
  credentialId: 'credential-1',
  agentId: 'agent-1',
  audience: 'hermes-negotiator' as const,
  setupAttemptId: 'setup-1',
};

describe('Hermes one-shot run capability', () => {
  it('binds an opaque capability to the exact task, run, credential, agent, and setup generation', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const issued = issueHermesRunCapability({
      taskId: 'task-1',
      runId: 'unmodelled-run-1',
      principal,
      now,
    });

    expect(issued.capability).not.toContain('task-1');
    expect(issued.binding).not.toHaveProperty('capability');
    expect(issued.binding).not.toHaveProperty('runId');
    expect(verifyHermesRunCapability(issued.binding, {
      taskId: 'task-1',
      runId: 'unmodelled-run-1',
      capability: issued.capability,
      principal,
      now: new Date(now.getTime() + 1_000),
    })).toBe('fresh');

    for (const altered of [
      { taskId: 'task-2' },
      { runId: 'unmodelled-run-2' },
      { principal: { ...principal, credentialId: 'credential-2' } },
      { principal: { ...principal, agentId: 'agent-2' } },
      { principal: { ...principal, setupAttemptId: 'setup-2' } },
      { capability: `${issued.capability}x` },
    ]) {
      expect(verifyHermesRunCapability(issued.binding, {
        taskId: 'task-1',
        runId: 'unmodelled-run-1',
        capability: issued.capability,
        principal,
        now: new Date(now.getTime() + 1_000),
        ...altered,
      })).toBe('invalid');
    }
  });

  it('classifies an exact consumed replay for deterministic idempotency and rejects expiry', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const issued = issueHermesRunCapability({ taskId: 'task-1', runId: 'run-1', principal, now });
    const consumed: HermesRunCapabilityBinding = {
      ...issued.binding,
      consumedAt: new Date(now.getTime() + 2_000).toISOString(),
      outcome: 'responded',
    };
    expect(verifyHermesRunCapability(consumed, {
      taskId: 'task-1', runId: 'run-1', capability: issued.capability, principal,
      now: new Date(now.getTime() + 3_000),
    })).toBe('replay');
    expect(verifyHermesRunCapability(consumed, {
      taskId: 'task-1', runId: 'run-1', capability: issued.capability, principal,
      now: new Date(now.getTime() + HERMES_RUN_CAPABILITY_TTL_MS + 1),
    })).toBe('replay');
    expect(verifyHermesRunCapability(issued.binding, {
      taskId: 'task-1', runId: 'run-1', capability: issued.capability, principal,
      now: new Date(now.getTime() + HERMES_RUN_CAPABILITY_TTL_MS + 1),
    })).toBe('expired');
  });
});
