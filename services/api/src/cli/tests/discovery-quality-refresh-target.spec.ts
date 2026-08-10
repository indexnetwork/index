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

  it('does not retain or serialize credential-bearing control-plane causes', async () => {
    const secret = 'refresh-provider-secret';
    const error = await attestWritableQualityBaseTarget({
      target: parseQualityBaseRefreshTarget(JSON.stringify(target)),
      controlPlane: {
        getBranch: async () => { throw new Error(secret, { cause: new Error(`nested-${secret}`) }); },
        listEndpoints: async () => { throw new Error('not reached'); },
      },
    }).catch((caught: Error) => caught);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secret);
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

  it('parses, attests, and then binds the runtime from the brand', async () => {
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
});
