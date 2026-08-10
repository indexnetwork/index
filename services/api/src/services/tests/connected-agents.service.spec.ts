import { describe, expect, it } from 'bun:test';

import { HERMES_CANONICAL_ACTIONS } from '../../lib/agent/hermes-capabilities';
import { ConnectedAgentNotFoundError, ConnectedAgentsService, type ConnectedAgentsStore, type HermesConnectionRecord } from '../connected-agents.service';

const OWNER = 'owner-1';
const NOW = new Date('2026-08-09T12:00:00.000Z');
const base: HermesConnectionRecord = {
  installationId: '11111111-1111-4111-8111-111111111111',
  agentId: '22222222-2222-4222-8222-222222222222',
  actions: HERMES_CANONICAL_ACTIONS,
  activationState: 'active',
  selected: true,
  lastHeartbeatAt: new Date('2026-08-09T11:59:30.000Z'),
  expiresAt: new Date('2026-09-08T12:00:00.000Z'),
};

class MemoryStore implements ConnectedAgentsStore {
  records: HermesConnectionRecord[] = [{ ...base }];
  pauseOutcome: 'paused' | 'absent' | 'owner_mismatch' = 'paused';
  revokeOutcome: 'revoked' | 'absent' | 'owner_mismatch' = 'revoked';
  pauseCalls: Array<{ ownerId: string; installationId: string }> = [];
  revokeCalls: Array<{ ownerId: string; installationId: string }> = [];

  async listHermesConnections(ownerId: string) {
    return ownerId === OWNER ? this.records : [];
  }

  async pauseHermesConnection(input: { ownerId: string; installationId: string }) {
    this.pauseCalls.push(input);
    if (this.pauseOutcome === 'paused') {
      this.records = this.records.map((record) => record.installationId === input.installationId
        ? { ...record, selected: false }
        : record);
    }
    return this.pauseOutcome;
  }

  async revokeHermesConnection(input: { ownerId: string; installationId: string }) {
    this.revokeCalls.push(input);
    if (this.revokeOutcome === 'revoked') {
      this.records = this.records.map((record) => record.installationId === input.installationId
        ? { ...record, selected: false, activationState: 'revoked' }
        : record);
    }
    return this.revokeOutcome;
  }
}

describe('ConnectedAgentsService', () => {
  it('derives the closed health enum and fallback from authoritative records', async () => {
    const store = new MemoryStore();
    store.records = [
      base,
      { ...base, installationId: 'pending', activationState: 'pending', selected: false },
      { ...base, installationId: 'stale', lastHeartbeatAt: new Date('2026-08-09T11:00:00.000Z') },
      { ...base, installationId: 'never', lastHeartbeatAt: null },
      { ...base, installationId: 'expired', expiresAt: new Date('2026-08-09T11:00:00.000Z') },
      { ...base, installationId: 'revoked', activationState: 'revoked' },
    ];
    const service = new ConnectedAgentsService(store, () => NOW);

    const { connections } = await service.list(OWNER);
    expect(connections.map(({ health }) => health)).toEqual([
      'active', 'pending', 'stale', 'never_seen', 'expired', 'revoked',
    ]);
    expect(connections[0]?.installationName).toBe('Hermes on macOS');
    expect(connections[0]?.actions).toEqual(HERMES_CANONICAL_ACTIONS);
    expect(connections[0]?.indexCovering).toBe(false);
    expect(connections[1]?.indexCovering).toBe(true);
    expect(connections[2]?.indexCovering).toBe(true);
  });

  it('pauses under the owner store contract and returns a refreshed view without revoking', async () => {
    const store = new MemoryStore();
    const service = new ConnectedAgentsService(store, () => NOW);

    const result = await service.pause(OWNER, base.installationId);

    expect(store.pauseCalls).toEqual([{ ownerId: OWNER, installationId: base.installationId }]);
    expect(result.selected).toBe(false);
    expect(result.activationState).toBe('active');
    expect(result.actions).toEqual(HERMES_CANONICAL_ACTIONS);
    expect(result.indexCovering).toBe(true);
  });

  it('revokes owner authority idempotently and hides cross-owner/nonexistent targets', async () => {
    const store = new MemoryStore();
    const service = new ConnectedAgentsService(store, () => NOW);
    await expect(service.revoke(OWNER, base.installationId)).resolves.toEqual({ revoked: true });

    store.revokeOutcome = 'owner_mismatch';
    await expect(service.revoke(OWNER, base.installationId)).rejects.toBeInstanceOf(ConnectedAgentNotFoundError);
    store.pauseOutcome = 'absent';
    await expect(service.pause(OWNER, base.installationId)).rejects.toBeInstanceOf(ConnectedAgentNotFoundError);
  });
});
