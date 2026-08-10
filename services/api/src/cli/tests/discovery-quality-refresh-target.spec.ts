import { describe, expect, it } from 'bun:test';

import { attestWritableQualityBaseTarget, parseQualityBaseRefreshTarget, runQualityBaseRefreshTargetAttestation, type AttestedWritableQualityBaseTarget } from '../discovery-quality-refresh-target';
import { handoffHistoricalQualityBaseRuntime, runHistoricalQualityBaseBootstrap } from '../discovery-quality-base';
import type { NeonControlPlane } from '../discovery-env-matrix.neon';

const target = {
  version: 2,
  projectId: 'project-quality',
  branchId: 'br-quality-base',
  endpointId: 'ep-quality-base',
  databaseName: 'protocol_eval',
  databaseUrl: 'postgresql://owner:secret@ep-quality-base-pooler.neon.tech:5432/protocol_eval',
} as const;

function controlPlane(input: {
  branchName?: string;
  primary?: boolean;
  endpointType?: 'read_only' | 'read_write';
  endpointHost?: string;
} = {}): NeonControlPlane {
  return {
    getBranch: async (projectId, branchId) => {
      expect(projectId).toBe(target.projectId);
      expect(branchId).toBe(target.branchId);
      return {
        id: branchId,
        name: input.branchName ?? 'eval-discovery-base',
        parentId: null,
        expiresAt: null,
        primary: input.primary ?? false,
      };
    },
    listEndpoints: async (projectId, branchId) => {
      expect(projectId).toBe(target.projectId);
      expect(branchId).toBe(target.branchId);
      return [{
        id: target.endpointId,
        branchId: target.branchId,
        host: input.endpointHost ?? 'ep-quality-base.neon.tech',
        type: input.endpointType ?? 'read_write',
      }];
    },
  };
}

describe('historical quality writable refresh target', () => {
  it('strictly parses only the v2 protocol_eval Neon target', () => {
    expect(parseQualityBaseRefreshTarget(JSON.stringify(target))).toEqual(target);
    for (const malformed of [
      undefined,
      '{',
      JSON.stringify({ ...target, version: 1 }),
      JSON.stringify({ ...target, extra: true }),
      JSON.stringify({ ...target, databaseName: 'postgres' }),
      JSON.stringify({ ...target, databaseUrl: 'postgresql://owner:secret@ep-quality-base.neon.tech:6543/protocol_eval' }),
      JSON.stringify({ ...target, databaseUrl: 'postgresql://owner:secret@ep-quality-base.neon.tech:5432/other' }),
      JSON.stringify({ ...target, databaseUrl: 'postgresql://owner:secret@example.com:5432/protocol_eval' }),
    ]) expect(() => parseQualityBaseRefreshTarget(malformed)).toThrow();
  });

  it('attests the exact non-primary base branch, endpoint host, database, and read_write type', async () => {
    const parsed = parseQualityBaseRefreshTarget(JSON.stringify(target));
    const attested = await attestWritableQualityBaseTarget({ target: parsed, controlPlane: controlPlane() });
    expect(attested).toEqual({ ...target, endpointType: 'read_write', branchName: 'eval-discovery-base', primary: false });

    await expect(attestWritableQualityBaseTarget({ target: parsed, controlPlane: controlPlane({ branchName: 'other' }) })).rejects.toThrow('identity');
    await expect(attestWritableQualityBaseTarget({ target: parsed, controlPlane: controlPlane({ primary: true }) })).rejects.toThrow('identity');
    await expect(attestWritableQualityBaseTarget({ target: parsed, controlPlane: controlPlane({ endpointType: 'read_only' }) })).rejects.toThrow('read_write');
    await expect(attestWritableQualityBaseTarget({ target: parsed, controlPlane: controlPlane({ endpointHost: 'other.neon.tech' }) })).rejects.toThrow('endpoint');
  });

  it.each([
    ['https scheme', 'https://owner:unsafe-secret@ep-quality-base.neon.tech/protocol_eval'],
    ['wrong path', 'postgresql://owner:unsafe-secret@ep-quality-base.neon.tech/other'],
    ['wrong port', 'postgresql://owner:unsafe-secret@ep-quality-base.neon.tech:6543/protocol_eval'],
    ['malformed credentials', 'postgresql://owner:%ZZ-unsafe-secret@ep-quality-base.neon.tech/protocol_eval'],
  ])('refuses a structurally supplied target with %s before minting the attestation brand', async (_label, databaseUrl) => {
    let controlPlaneCalled = false;
    const error = await attestWritableQualityBaseTarget({
      target: { ...target, databaseUrl },
      controlPlane: {
        getBranch: async () => {
          controlPlaneCalled = true;
          throw new Error('must not reach control plane');
        },
        listEndpoints: async () => { throw new Error('must not reach control plane'); },
      },
    }).catch((caught: Error) => caught);
    expect(controlPlaneCalled).toBeFalse();
    expect(error.message).toBe('Historical quality writable refresh control-plane attestation failed');
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('unsafe-secret');
  });

  it('does not retain or serialize credential-bearing control-plane causes or raw URLs', async () => {
    const secret = 'refresh-provider-secret';
    const unsafeUrl = `postgresql://owner:${secret}@ep-quality-base.neon.tech/protocol_eval`;
    const error = await attestWritableQualityBaseTarget({
      target: { ...target, databaseUrl: unsafeUrl },
      controlPlane: {
        getBranch: async () => { throw new Error(secret, { cause: new Error(`nested-${secret}`) }); },
        listEndpoints: async () => { throw new Error('not reached'); },
      },
    }).catch((caught: Error) => caught);
    expect(error.cause).toBeUndefined();
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(unsafeUrl);
  });

  it('requires the branded attestation before runtime binding', () => {
    const compileOnlyBoundary = () => {
      // @ts-expect-error A parsed target has not been control-plane attested.
      return handoffHistoricalQualityBaseRuntime({ target, args: [], spawn: () => { throw new Error('must not spawn'); } });
    };
    expect(compileOnlyBoundary).toBeFunction();
  });

  it('runs the attest-only command without any DB, provider, reset, migration, seed, or runtime port', async () => {
    const calls: string[] = [];
    const result = await runQualityBaseRefreshTargetAttestation({
      env: { DISCOVERY_QUALITY_BASE_REFRESH_TARGET: JSON.stringify(target) },
      controlPlane: controlPlane(),
      log: (line) => calls.push(line),
    });
    expect(result.endpointType).toBe('read_write');
    expect(calls).toEqual(['Historical quality base writable refresh target attested.']);
  });

  it('spawns a fresh verifier with read-only enforcement and no provider, Redis, or control-plane secrets', async () => {
    const attested = await attestWritableQualityBaseTarget({
      target: parseQualityBaseRefreshTarget(JSON.stringify(target)),
      controlPlane: controlPlane(),
    });
    let childEnvironment: NodeJS.ProcessEnv | undefined;
    await handoffHistoricalQualityBaseRuntime({
      target: attested,
      args: ['--verify'],
      env: {
        OPENROUTER_API_KEY: 'provider-secret',
        OPENAI_API_KEY: 'provider-secret-2',
        REDIS_URL: 'redis://secret',
        REDIS_HOST: 'secret-host',
        REDIS_PORT: '6379',
        NEON_API_KEY: 'control-secret',
        EMBEDDING_MODEL: 'provider-model',
        CHAT_MODEL: 'provider-chat-model',
        DISCOVERY_QUALITY_BASE_REFRESH_TARGET: 'control-manifest',
        SAFE_VALUE: 'preserved',
      },
      spawn: (options) => {
        childEnvironment = options.env;
        return { stdout: null, stderr: null, exited: Promise.resolve(0) };
      },
    });
    expect(childEnvironment?.DATABASE_URL).toBe(target.databaseUrl);
    expect(childEnvironment?.PGOPTIONS).toContain('transaction_read_only=on');
    expect(childEnvironment?.SAFE_VALUE).toBe('preserved');
    for (const key of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'NEON_API_KEY', 'EMBEDDING_MODEL', 'CHAT_MODEL', 'DISCOVERY_QUALITY_BASE_REFRESH_TARGET']) {
      expect(childEnvironment?.[key]).toBeUndefined();
    }
  });

  it('parses, attests, and then binds refresh runtime from the writable brand', async () => {
    const calls: string[] = [];
    await runHistoricalQualityBaseBootstrap({
      args: [],
      env: { DISCOVERY_QUALITY_BASE_REFRESH_TARGET: JSON.stringify(target) },
      controlPlane: controlPlane(),
      handoff: async (attested: AttestedWritableQualityBaseTarget, args) => {
        calls.push(`${attested.endpointType}:${args.join(',')}`);
        return '';
      },
    });
    expect(calls).toEqual(['read_write:']);
  });

  it('strictly attests v2 and binds verify only to the base read replica', async () => {
    const replicaUrl = 'postgresql://reader:replica-secret@ep-quality-readonly.neon.tech/protocol_eval';
    const manifest = {
      version: 2 as const,
      projectId: target.projectId,
      baseBranchId: target.branchId,
      baseReadReplica: { endpointId: 'ep-quality-readonly', databaseUrl: replicaUrl },
      targets: [
        { sideId: 'a' as const, branchId: 'br-a', endpointId: 'ep-a', databaseUrl: 'postgresql://a:a-secret@ep-a.neon.tech/protocol_eval' },
        { sideId: 'b' as const, branchId: 'br-b', endpointId: 'ep-b', databaseUrl: 'postgresql://b:b-secret@ep-b.neon.tech/protocol_eval' },
      ],
    };
    const richControlPlane: NeonControlPlane = {
      getBranch: async (_projectId, branchId) => {
        if (branchId === target.branchId) return { id: branchId, name: 'eval-discovery-base', parentId: null, expiresAt: null, primary: false };
        return { id: branchId, name: branchId === 'br-a' ? 'eval-ab-a' : 'eval-ab-b', parentId: target.branchId, expiresAt: null, primary: false };
      },
      listEndpoints: async (_projectId, branchId) => {
        if (branchId === target.branchId) return [
          { id: target.endpointId, branchId, host: 'ep-quality-base.neon.tech', type: 'read_write' },
          { id: manifest.baseReadReplica.endpointId, branchId, host: 'ep-quality-readonly.neon.tech', type: 'read_only' },
        ];
        const side = branchId === 'br-a' ? manifest.targets[0] : manifest.targets[1];
        return [{ id: side.endpointId, branchId, host: `${side.endpointId}.neon.tech`, type: 'read_write' }];
      },
    };
    const seen: string[] = [];
    await runHistoricalQualityBaseBootstrap({
      args: ['--verify'],
      env: {
        DISCOVERY_QUALITY_BASE_REFRESH_TARGET: JSON.stringify(target),
        DISCOVERY_TARGETS: JSON.stringify(manifest),
      },
      controlPlane: richControlPlane,
      handoff: async () => { throw new Error('verify must not use writable refresh handoff'); },
      verifyHandoff: async (attested, args) => {
        seen.push(attested.databaseUrl, ...args);
        return 'identifier-only output';
      },
    });
    expect(seen).toEqual([replicaUrl, '--verify']);
    expect(seen).not.toContain(target.databaseUrl);
  });
});
