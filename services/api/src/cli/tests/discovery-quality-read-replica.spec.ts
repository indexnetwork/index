import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { READ_REPLICA_CONFIRMATION, runQualityReadReplicaAttestation, runQualityReadReplicaProvision, type QualityReadReplicaControlPlane, type QualityReadReplicaSecureRecord, type QualityReadReplicaSecureRecordStore } from '../discovery-quality-read-replica';

const legacyManifest = {
  projectId: 'project-quality',
  baseBranchId: 'br-quality-base',
  targets: [
    { sideId: 'a', branchId: 'br-a', endpointId: 'ep-a', databaseUrl: 'postgresql://a:secret-a@ep-a.neon.tech/protocol_eval' },
    { sideId: 'b', branchId: 'br-b', endpointId: 'ep-b', databaseUrl: 'postgresql://b:secret-b@ep-b.neon.tech/protocol_eval' },
  ],
} as const;

const refreshTarget = {
  version: 2,
  projectId: 'project-quality',
  branchId: 'br-quality-base',
  endpointId: 'ep-refresh',
  databaseName: 'protocol_eval',
  databaseUrl: 'postgresql://writer:refresh-secret@ep-refresh.neon.tech/protocol_eval',
} as const;

const qualityManifest = {
  version: 2,
  ...legacyManifest,
  baseReadReplica: {
    endpointId: 'ep-replica',
    databaseUrl: 'postgresql://reader:replica-secret@ep-replica.neon.tech/protocol_eval',
  },
} as const;

const provisionArgs = [
  '--base-branch-name', 'eval-discovery-base',
  '--endpoint-type', 'read_only',
  '--database-name', 'protocol_eval',
  '--secure-record', '/secure/read-replica.json',
] as const;
const attestArgs = ['--secure-record', '/secure/read-replica.json'] as const;

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DISCOVERY_QUALITY_READ_REPLICA_CONFIRM: READ_REPLICA_CONFIRMATION,
    NEON_API_KEY: 'neon-api-secret',
    DISCOVERY_TARGETS: JSON.stringify(legacyManifest),
    DISCOVERY_QUALITY_BASE_REFRESH_TARGET: JSON.stringify(refreshTarget),
    ...overrides,
  };
}

function makeControlPlane(input: {
  baseName?: string;
  primary?: boolean;
  before?: Array<{ id: string; branchId: string; host: string; type: 'read_only' | 'read_write' }>;
  created?: { id: string; branchId: string; host: string; type: 'read_only' | 'read_write' };
  after?: Array<{ id: string; branchId: string; host: string; type: 'read_only' | 'read_write' }>;
  createError?: Error;
} = {}): { controlPlane: QualityReadReplicaControlPlane; calls: string[] } {
  const calls: string[] = [];
  let listed = 0;
  const writable = { id: 'ep-refresh', branchId: 'br-quality-base', host: 'ep-refresh.neon.tech', type: 'read_write' as const };
  const created = input.created ?? { id: 'ep-replica', branchId: 'br-quality-base', host: 'ep-replica.neon.tech', type: 'read_only' as const };
  return {
    calls,
    controlPlane: {
      getBranch: async (projectId, branchId) => {
        calls.push(`getBranch:${projectId}:${branchId}`);
        return {
          id: branchId,
          name: input.baseName ?? 'eval-discovery-base',
          parentId: null,
          expiresAt: null,
          primary: input.primary ?? false,
        };
      },
      listEndpoints: async (projectId, branchId) => {
        calls.push(`listEndpoints:${projectId}:${branchId}`);
        listed += 1;
        return listed <= 2 ? input.before ?? [writable] : input.after ?? [writable, created];
      },
      createReadOnlyEndpoint: async (projectId, branchId) => {
        calls.push(`createReadOnlyEndpoint:${projectId}:${branchId}`);
        if (input.createError) throw input.createError;
        return created;
      },
    },
  };
}

function memoryRecordStore(initial?: QualityReadReplicaSecureRecord, mode = 0o600, input: {
  reserveError?: Error;
  commitError?: Error;
} = {}): {
  store: QualityReadReplicaSecureRecordStore;
  events: string[];
  records: QualityReadReplicaSecureRecord[];
} {
  const events: string[] = [];
  const records: QualityReadReplicaSecureRecord[] = [];
  let record = initial;
  return {
    events,
    records,
    store: {
      reserve: async (path, requestedMode) => {
        events.push(`reserve:${path}:${requestedMode.toString(8)}`);
        if (input.reserveError) throw input.reserveError;
        return {
          writeRecovery: async (next) => {
            events.push('write-recovery');
            records.push(next);
            record = next;
          },
          commit: async (next) => {
            events.push('commit');
            if (input.commitError) throw input.commitError;
            records.push(next);
            record = next;
          },
          abandon: async () => { events.push('abandon'); },
        };
      },
      read: async () => ({ value: record, mode }),
    },
  };
}

const initialRecord: QualityReadReplicaSecureRecord = {
  version: 1,
  projectId: 'project-quality',
  baseBranchId: 'br-quality-base',
  endpointId: 'ep-replica',
  endpointHost: 'ep-replica.neon.tech',
  endpointType: 'read_only',
  databaseName: 'protocol_eval',
  status: 'attested',
};

describe('historical quality read-replica provision command', () => {
  it.each([undefined, '', '1', 'yes', 'provision read replica'])('requires the exact standalone confirmation %p', async (confirmation) => {
    const { controlPlane, calls } = makeControlPlane();
    await expect(runQualityReadReplicaProvision({
      args: provisionArgs,
      env: environment({ DISCOVERY_QUALITY_READ_REPLICA_CONFIRM: confirmation }),
      controlPlane,
      recordStore: memoryRecordStore().store,
      log: () => {},
    })).rejects.toThrow('DISCOVERY_QUALITY_READ_REPLICA_CONFIRM');
    expect(calls).toEqual([]);
  });

  it('attests the exact base before creating one read_only endpoint, reattests it, and writes mode 0600', async () => {
    const { controlPlane, calls } = makeControlPlane();
    const records = memoryRecordStore();
    const output: string[] = [];
    const result = await runQualityReadReplicaProvision({
      args: provisionArgs,
      env: environment(),
      controlPlane,
      recordStore: records.store,
      log: (line) => output.push(line),
    });

    expect(calls).toEqual([
      'getBranch:project-quality:br-quality-base',
      'listEndpoints:project-quality:br-quality-base',
      'listEndpoints:project-quality:br-quality-base',
      'createReadOnlyEndpoint:project-quality:br-quality-base',
      'listEndpoints:project-quality:br-quality-base',
    ]);
    expect(records.events).toEqual([
      'reserve:/secure/read-replica.json:600', 'write-recovery', 'commit',
    ]);
    expect(records.records.at(-1)).toEqual(initialRecord);
    expect(result).toEqual(initialRecord);
    expect(JSON.parse(output[0]!)).toEqual({
      projectId: 'project-quality',
      branchId: 'br-quality-base',
      endpointId: 'ep-replica',
      type: 'read_only',
      databaseName: 'protocol_eval',
    });
    expect(output.join('\n')).not.toContain('secret');
    expect(output.join('\n')).not.toContain('neon.tech');
  });

  it('creates the real secure record with exact mode 0600 and no URL or credential', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quality-replica-'));
    const recordPath = path.join(directory, 'record.json');
    try {
      await runQualityReadReplicaProvision({
        args: [...provisionArgs.slice(0, -1), recordPath],
        env: environment(),
        controlPlane: makeControlPlane().controlPlane,
        log: () => {},
      });
      expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
      const raw = await readFile(recordPath, 'utf8');
      expect(JSON.parse(raw)).toEqual(initialRecord);
      expect(raw).not.toContain('replica-secret');
      expect(raw).not.toContain('neon-api-secret');
      expect(raw).not.toContain('databaseUrl');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([undefined, '', JSON.stringify({ ...refreshTarget, endpointId: '' })])('requires a strict writable refresh target before any create: %p', async (raw) => {
    const { controlPlane, calls } = makeControlPlane();
    await expect(runQualityReadReplicaProvision({
      args: provisionArgs,
      env: environment({ DISCOVERY_QUALITY_BASE_REFRESH_TARGET: raw }),
      controlPlane,
      recordStore: memoryRecordStore().store,
      log: () => {},
    })).rejects.toThrow();
    expect(calls.some((call) => call.startsWith('create'))).toBeFalse();
  });

  it.each([
    ['project', { ...refreshTarget, projectId: 'project-other' }],
    ['base branch', { ...refreshTarget, branchId: 'br-other' }],
  ])('binds the separately attested refresh %s to the legacy project/base before create', async (_label, target) => {
    const events: string[] = [];
    const controlPlane: QualityReadReplicaControlPlane = {
      getBranch: async (_projectId, branchId) => ({ id: branchId, name: 'eval-discovery-base', parentId: null, expiresAt: null, primary: false }),
      listEndpoints: async (_projectId, branchId) => [{ id: 'ep-refresh', branchId, host: 'ep-refresh.neon.tech', type: 'read_write' }],
      createReadOnlyEndpoint: async () => { events.push('create'); throw new Error('must not create'); },
    };
    const records = memoryRecordStore();
    await expect(runQualityReadReplicaProvision({
      args: provisionArgs,
      env: environment({ DISCOVERY_QUALITY_BASE_REFRESH_TARGET: JSON.stringify(target) }),
      controlPlane,
      recordStore: records.store,
      log: () => {},
    })).rejects.toThrow();
    expect(events).toEqual([]);
    expect(records.events).toEqual([]);
  });

  it('rejects a separately attested refresh endpoint crossing a child role before reservation or create', async () => {
    const crossed = { ...refreshTarget, endpointId: 'ep-a', databaseUrl: 'postgresql://writer:x@ep-a.neon.tech/protocol_eval' };
    const { controlPlane, calls } = makeControlPlane({
      before: [{ id: 'ep-a', branchId: 'br-quality-base', host: 'ep-a.neon.tech', type: 'read_write' }],
    });
    const records = memoryRecordStore();
    await expect(runQualityReadReplicaProvision({
      args: provisionArgs,
      env: environment({ DISCOVERY_QUALITY_BASE_REFRESH_TARGET: JSON.stringify(crossed) }),
      controlPlane,
      recordStore: records.store,
      log: () => {},
    })).rejects.toThrow();
    expect(records.events).toEqual([]);
    expect(calls.some((call) => call.startsWith('create'))).toBeFalse();
  });

  it('reserves the secure record before create and refuses an unwritable reservation without mutation', async () => {
    const records = memoryRecordStore(undefined, 0o600, { reserveError: new Error('unwritable secret path') });
    const { controlPlane, calls } = makeControlPlane();
    const error = await runQualityReadReplicaProvision({
      args: provisionArgs, env: environment(), controlPlane, recordStore: records.store, log: () => {},
    }).catch((caught: Error) => caught);
    expect(records.events).toEqual(['reserve:/secure/read-replica.json:600']);
    expect(calls.some((call) => call.startsWith('create'))).toBeFalse();
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('unwritable secret path');
  });

  it('orders exclusive reservation before the irreversible create call', async () => {
    const records = memoryRecordStore();
    const { controlPlane } = makeControlPlane();
    const create = controlPlane.createReadOnlyEndpoint;
    controlPlane.createReadOnlyEndpoint = async (projectId, branchId) => {
      expect(records.events).toEqual(['reserve:/secure/read-replica.json:600']);
      return create(projectId, branchId);
    };
    await runQualityReadReplicaProvision({
      args: provisionArgs, env: environment(), controlPlane, recordStore: records.store, log: () => {},
    });
  });

  it('refuses an existing secure-record path before create and preserves its contents', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quality-replica-existing-'));
    const recordPath = path.join(directory, 'record.json');
    await Bun.write(recordPath, 'preserve-me');
    const { controlPlane, calls } = makeControlPlane();
    try {
      await expect(runQualityReadReplicaProvision({
        args: [...provisionArgs.slice(0, -1), recordPath], env: environment(), controlPlane, log: () => {},
      })).rejects.toThrow();
      expect(calls.some((call) => call.startsWith('create'))).toBeFalse();
      expect(await readFile(recordPath, 'utf8')).toBe('preserve-me');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('holds an exclusive real-path reservation so a concurrent provision cannot create', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quality-replica-concurrent-'));
    const recordPath = path.join(directory, 'record.json');
    let releaseCreate!: () => void;
    let announceCreate!: () => void;
    const createStarted = new Promise<void>((resolve) => { announceCreate = resolve; });
    const release = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const first = makeControlPlane();
    const originalCreate = first.controlPlane.createReadOnlyEndpoint;
    first.controlPlane.createReadOnlyEndpoint = async (projectId, branchId) => {
      announceCreate();
      await release;
      return originalCreate(projectId, branchId);
    };
    try {
      const firstRun = runQualityReadReplicaProvision({
        args: [...provisionArgs.slice(0, -1), recordPath], env: environment(), controlPlane: first.controlPlane, log: () => {},
      });
      await createStarted;
      expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(recordPath, 'utf8'))).toEqual({ status: 'reserved' });
      const second = makeControlPlane();
      await expect(runQualityReadReplicaProvision({
        args: [...provisionArgs.slice(0, -1), recordPath], env: environment(), controlPlane: second.controlPlane, log: () => {},
      })).rejects.toThrow();
      expect(second.calls.some((call) => call.startsWith('create'))).toBeFalse();
      releaseCreate();
      await firstRun;
    } finally {
      releaseCreate?.();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['wrong base name', { baseName: 'production' }],
    ['primary base', { primary: true }],
  ])('refuses a %s before endpoint creation', async (_label, overrides) => {
    const { controlPlane, calls } = makeControlPlane(overrides);
    await expect(runQualityReadReplicaProvision({
      args: provisionArgs, env: environment(), controlPlane, recordStore: memoryRecordStore().store, log: () => {},
    })).rejects.toThrow('Historical quality read-replica provisioning failed');
    expect(calls.some((call) => call.startsWith('create'))).toBeFalse();
  });

  it('refuses when a read replica already exists instead of creating a duplicate', async () => {
    const { controlPlane, calls } = makeControlPlane({
      before: [
        { id: 'ep-refresh', branchId: 'br-quality-base', host: 'ep-refresh.neon.tech', type: 'read_write' },
        { id: 'ep-existing', branchId: 'br-quality-base', host: 'ep-existing.neon.tech', type: 'read_only' },
      ],
    });
    const records = memoryRecordStore();
    await expect(runQualityReadReplicaProvision({
      args: provisionArgs, env: environment(), controlPlane, recordStore: records.store, log: () => {},
    })).rejects.toThrow('Historical quality read-replica provisioning failed');
    expect(calls.some((call) => call.startsWith('create'))).toBeFalse();
    expect(records.events.at(-1)).toBe('abandon');
  });

  it.each([
    ['read_write response', { created: { id: 'ep-replica', branchId: 'br-quality-base', host: 'ep-replica.neon.tech', type: 'read_write' as const } }],
    ['crossed branch response', { created: { id: 'ep-replica', branchId: 'br-a', host: 'ep-replica.neon.tech', type: 'read_only' as const } }],
    ['crossed reattestation', {
      after: [
        { id: 'ep-refresh', branchId: 'br-quality-base', host: 'ep-refresh.neon.tech', type: 'read_write' as const },
        { id: 'ep-replica', branchId: 'br-a', host: 'ep-replica.neon.tech', type: 'read_only' as const },
      ],
    }],
  ])('refuses a %s but retains a recovery record for the created endpoint', async (_label, overrides) => {
    const { controlPlane } = makeControlPlane(overrides);
    const records = memoryRecordStore();
    await expect(runQualityReadReplicaProvision({
      args: provisionArgs, env: environment(), controlPlane, recordStore: records.store, log: () => {},
    })).rejects.toThrow();
    expect(records.records).toHaveLength(1);
    expect(records.records[0]).toMatchObject({ endpointId: 'ep-replica', status: 'recovery_required' });
  });

  it('retains a real mode-0600 recovery record when post-create reattestation fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quality-replica-recovery-'));
    const recordPath = path.join(directory, 'record.json');
    const { controlPlane } = makeControlPlane({
      after: [{ id: 'ep-refresh', branchId: 'br-quality-base', host: 'ep-refresh.neon.tech', type: 'read_write' }],
    });
    try {
      await expect(runQualityReadReplicaProvision({
        args: [...provisionArgs.slice(0, -1), recordPath], env: environment(), controlPlane, log: () => {},
      })).rejects.toThrow();
      expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(recordPath, 'utf8'))).toMatchObject({
        endpointId: 'ep-replica', endpointHost: 'ep-replica.neon.tech', status: 'recovery_required',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains the recovery record when final record commit fails after create', async () => {
    const records = memoryRecordStore(undefined, 0o600, { commitError: new Error('disk-secret-finalize') });
    const error = await runQualityReadReplicaProvision({
      args: provisionArgs,
      env: environment(),
      controlPlane: makeControlPlane().controlPlane,
      recordStore: records.store,
      log: () => {},
    }).catch((caught: Error) => caught);
    expect(records.records).toHaveLength(1);
    expect(records.records[0]).toMatchObject({
      endpointId: 'ep-replica', endpointHost: 'ep-replica.neon.tech', status: 'recovery_required',
    });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('disk-secret-finalize');
  });

  it('sanitizes create API failures and writes no record', async () => {
    const records = memoryRecordStore();
    const error = await runQualityReadReplicaProvision({
      args: provisionArgs,
      env: environment(),
      controlPlane: makeControlPlane({ createError: new Error('401 neon-api-secret response-password') }).controlPlane,
      recordStore: records.store,
      log: () => {},
    }).catch((caught: Error) => caught);
    expect(error.message).not.toContain('neon-api-secret');
    expect(error.message).not.toContain('response-password');
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('response-password');
    expect(records.records).toEqual([]);
    expect(records.events).toContain('abandon');
  });

  it('rejects any provisioning shape other than the fixed base/type/database contract', async () => {
    for (const args of [
      [...provisionArgs.slice(0, 1), 'other', ...provisionArgs.slice(2)],
      [...provisionArgs.slice(0, 3), 'read_write', ...provisionArgs.slice(4)],
      [...provisionArgs.slice(0, 5), 'postgres', ...provisionArgs.slice(6)],
      [...provisionArgs, '--extra'],
    ]) {
      await expect(runQualityReadReplicaProvision({
        args, env: environment(), controlPlane: makeControlPlane().controlPlane, recordStore: memoryRecordStore().store, log: () => {},
      })).rejects.toThrow();
    }
  });
});

describe('historical quality read-replica attest command', () => {
  it('attests the create-free secure record with no confirmation or runtime dependency', async () => {
    const { controlPlane, calls } = makeControlPlane({ before: [
      { id: 'ep-refresh', branchId: 'br-quality-base', host: 'ep-refresh.neon.tech', type: 'read_write' },
      { id: 'ep-replica', branchId: 'br-quality-base', host: 'ep-replica.neon.tech', type: 'read_only' },
    ] });
    const output: string[] = [];
    await runQualityReadReplicaAttestation({
      args: attestArgs,
      env: environment({ DISCOVERY_QUALITY_READ_REPLICA_CONFIRM: undefined }),
      controlPlane,
      recordStore: memoryRecordStore(initialRecord).store,
      log: (line) => output.push(line),
    });
    expect(calls).toEqual([
      'getBranch:project-quality:br-quality-base',
      'listEndpoints:project-quality:br-quality-base',
      'getBranch:project-quality:br-quality-base',
      'listEndpoints:project-quality:br-quality-base',
    ]);
    expect(calls.some((call) => call.startsWith('create'))).toBeFalse();
    expect(Object.keys(JSON.parse(output[0]!)).sort()).toEqual([
      'branchId', 'databaseName', 'endpointId', 'projectId', 'type',
    ]);
  });

  it('strictly attests an optional proposed v2 manifest and all endpoint roles', async () => {
    const calls: string[] = [];
    const controlPlane: QualityReadReplicaControlPlane = {
      getBranch: async (_projectId, branchId) => {
        calls.push(`get:${branchId}`);
        return {
          id: branchId,
          name: branchId === 'br-quality-base' ? 'eval-discovery-base' : branchId === 'br-a' ? 'eval-ab-a' : 'eval-ab-b',
          parentId: branchId === 'br-quality-base' ? null : 'br-quality-base',
          expiresAt: null,
          primary: false,
        };
      },
      listEndpoints: async (_projectId, branchId) => {
        calls.push(`list:${branchId}`);
        if (branchId === 'br-quality-base') return [
          { id: 'ep-replica', branchId, host: 'ep-replica.neon.tech', type: 'read_only' },
          { id: 'ep-refresh', branchId, host: 'ep-refresh.neon.tech', type: 'read_write' },
        ];
        return [{ id: branchId === 'br-a' ? 'ep-a' : 'ep-b', branchId, host: branchId === 'br-a' ? 'ep-a.neon.tech' : 'ep-b.neon.tech', type: 'read_write' }];
      },
      createReadOnlyEndpoint: async () => { throw new Error('attest must never create'); },
    };
    await runQualityReadReplicaAttestation({
      args: attestArgs,
      env: environment(),
      controlPlane,
      recordStore: memoryRecordStore({ ...initialRecord, proposedManifest: qualityManifest }).store,
      log: () => {},
    });
    expect(calls).toEqual([
      'get:br-quality-base', 'list:br-quality-base',
      'get:br-quality-base', 'list:br-quality-base',
      'get:br-a', 'list:br-a', 'get:br-b', 'list:br-b',
    ]);
  });

  it.each([0o644, 0o666, 0o400])('refuses a secure record whose mode is not exactly 0600 (%o)', async (mode) => {
    await expect(runQualityReadReplicaAttestation({
      args: attestArgs,
      env: environment(),
      controlPlane: makeControlPlane().controlPlane,
      recordStore: memoryRecordStore(initialRecord, mode).store,
      log: () => {},
    })).rejects.toThrow('Historical quality read-replica attestation failed');
  });

  it('removes credential-bearing causes from structured attest failures', async () => {
    const secret = 'refresh-control-secret';
    const error = await runQualityReadReplicaAttestation({
      args: attestArgs,
      env: environment(),
      controlPlane: {
        ...makeControlPlane().controlPlane,
        getBranch: async () => { throw new Error(secret, { cause: new Error(`nested-${secret}`) }); },
      },
      recordStore: memoryRecordStore(initialRecord).store,
      log: () => {},
    }).catch((caught: Error) => caught);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secret);
  });

  it('rejects record/manifest endpoint crossing without echoing credentials', async () => {
    const crossed = {
      ...initialRecord,
      endpointId: 'ep-a',
      proposedManifest: qualityManifest,
    };
    const error = await runQualityReadReplicaAttestation({
      args: attestArgs,
      env: environment(),
      controlPlane: makeControlPlane().controlPlane,
      recordStore: memoryRecordStore(crossed).store,
      log: () => {},
    }).catch((caught: Error) => caught);
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('neon.tech');
  });
});
