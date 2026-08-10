import { describe, expect, it } from 'bun:test';

import { attestAbTargets, attestHistoricalQualityTargets, parseAbManifest, parseHistoricalQualityManifest, parseLegacyAbManifest, resetAbBranch, type AbManifest, type AttestedAbManifest, type DiscoveryManifestV2 } from '../discovery.neon';
import type { NeonControlPlane } from '../discovery-env-matrix.neon';

const manifest: AbManifest = {
  projectId: 'proj-1',
  baseBranchId: 'br-base',
  targets: [
    { sideId: 'a', branchId: 'br-a', endpointId: 'ep-a', databaseUrl: 'postgresql://u:p@ep-a.neon.tech/protocol_eval' },
    { sideId: 'b', branchId: 'br-b', endpointId: 'ep-b', databaseUrl: 'postgresql://u:p@ep-b.neon.tech/protocol_eval' },
  ],
};

const controlPlane = (overrides: Record<string, Partial<{ name: string; parentId: string | null; primary: boolean }>> = {}): NeonControlPlane => ({
  getBranch: async (_projectId, branchId) => ({
    id: branchId,
    name: { 'br-base': 'eval-discovery-base', 'br-a': 'eval-ab-a', 'br-b': 'eval-ab-b' }[branchId] ?? 'unknown',
    parentId: branchId === 'br-base' ? null : 'br-base',
    expiresAt: null,
    primary: false,
    ...overrides[branchId],
  }),
  listEndpoints: async (_projectId, branchId) => [
    { id: `ep-${branchId.slice(3)}`, branchId, host: `ep-${branchId.slice(3)}.neon.tech`, type: 'read_write' },
  ],
});

/** The only supported way to obtain the branded manifest `resetAbBranch` takes. */
const attest = (): Promise<AttestedAbManifest> => attestAbTargets({ manifest, controlPlane: controlPlane() });

const RESTORE_URL = 'https://console.neon.tech/api/v2/projects/proj-1/branches/br-a/restore';
const OPERATION_URL = (id: string): string => `https://console.neon.tech/api/v2/projects/proj-1/operations/${id}`;

/**
 * A restore that reports `operationIds`, then answers every poll with the next
 * status in `statuses` (repeating the last one forever, which is how a stuck
 * operation looks).
 */
const restoreFetch = (input: { operationIds: string[]; statuses: string[]; calls: string[] }): typeof fetch => {
  let poll = 0;
  return (async (url: string, init?: RequestInit) => {
    input.calls.push(`${init?.method ?? 'GET'} ${url}`);
    if ((init?.method ?? 'GET') === 'POST') {
      return new Response(JSON.stringify({
        branch: { id: 'br-a' },
        operations: input.operationIds.map((id) => ({ id, status: 'running', action: 'apply_config' })),
      }), { status: 200 });
    }
    const status = input.statuses[Math.min(poll, input.statuses.length - 1)] ?? 'finished';
    poll += 1;
    return new Response(JSON.stringify({ operation: { id: 'op-1', status, error: 'token sk-secret invalid' } }), { status: 200 });
  }) as unknown as typeof fetch;
};

const manifestJson = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  projectId: 'proj-1',
  baseBranchId: 'br-base',
  targets: manifest.targets,
  ...overrides,
});

const qualityManifest: DiscoveryManifestV2 = {
  version: 2,
  projectId: 'proj-1',
  baseBranchId: 'br-base',
  baseReadReplica: {
    endpointId: 'ep-replica',
    databaseUrl: 'postgresql://reader:replica-secret@ep-replica.neon.tech/protocol_eval',
  },
  targets: manifest.targets,
};

const qualityManifestJson = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  ...qualityManifest,
  ...overrides,
});

function qualityControlPlane(input: {
  baseName?: string;
  basePrimary?: boolean;
  branchByRequestedId?: Record<string, string>;
  parentByBranch?: Record<string, string | null>;
  endpointByRequestedBranch?: Record<string, { id: string; branchId: string; host: string; type: 'read_only' | 'read_write' }>;
} = {}): NeonControlPlane {
  return {
    getBranch: async (_projectId, requestedBranchId) => {
      const id = input.branchByRequestedId?.[requestedBranchId] ?? requestedBranchId;
      return {
        id,
        name: requestedBranchId === 'br-base'
          ? input.baseName ?? 'eval-discovery-base'
          : requestedBranchId === 'br-a' ? 'eval-ab-a' : 'eval-ab-b',
        parentId: requestedBranchId === 'br-base' ? null : input.parentByBranch?.[requestedBranchId] ?? 'br-base',
        expiresAt: null,
        primary: requestedBranchId === 'br-base' ? input.basePrimary ?? false : false,
      };
    },
    listEndpoints: async (_projectId, requestedBranchId) => {
      const override = input.endpointByRequestedBranch?.[requestedBranchId];
      if (override) return [override];
      if (requestedBranchId === 'br-base') {
        return [{ id: 'ep-replica', branchId: 'br-base', host: 'ep-replica.neon.tech', type: 'read_only' }];
      }
      return [{
        id: requestedBranchId === 'br-a' ? 'ep-a' : 'ep-b',
        branchId: requestedBranchId,
        host: requestedBranchId === 'br-a' ? 'ep-a.neon.tech' : 'ep-b.neon.tech',
        type: 'read_write',
      }];
    },
  };
}

describe('attestAbTargets', () => {
  it('accepts two A/B branches parented on the attested base', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane() })).resolves.toBeDefined();
  });

  it('refuses a branch whose name is not a designated A/B branch', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-a': { name: 'dev' } }) }))
      .rejects.toThrow(/identity is invalid/);
  });

  it('refuses a branch that is not parented on the base', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-b': { parentId: 'br-production' } }) }))
      .rejects.toThrow(/identity is invalid/);
  });

  it('refuses the primary branch outright', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-a': { primary: true } }) }))
      .rejects.toThrow(/identity is invalid/);
  });

  it('refuses a base branch that is not the protected fixture base', async () => {
    await expect(attestAbTargets({ manifest, controlPlane: controlPlane({ 'br-base': { name: 'production' } }) }))
      .rejects.toThrow(/base branch identity is invalid/);
  });

  it('keeps legacy A/B endpoint-type behavior unchanged and ignores read_only versus read_write', async () => {
    const legacyControlPlane = controlPlane();
    await expect(attestAbTargets({
      manifest,
      controlPlane: {
        ...legacyControlPlane,
        listEndpoints: async (_projectId, branchId) => [{
          id: `ep-${branchId.slice(3)}`,
          branchId,
          host: `ep-${branchId.slice(3)}.neon.tech`,
          type: 'read_only',
        }],
      },
    })).resolves.toBeDefined();
  });

  it('refuses a side whose endpoint host is not the host in its DATABASE_URL', async () => {
    const crossed: AbManifest = {
      ...manifest,
      targets: [manifest.targets[0], { ...manifest.targets[1], databaseUrl: 'postgresql://u:p@ep-production.neon.tech/protocol_eval' }],
    };
    await expect(attestAbTargets({ manifest: crossed, controlPlane: controlPlane() }))
      .rejects.toThrow(/endpoint host does not match DATABASE_URL/);
  });

  it('never puts a DATABASE_URL in the error, because it carries a password', async () => {
    const malformed: AbManifest = {
      ...manifest,
      targets: [{ ...manifest.targets[0], databaseUrl: 'not-a-url://u:hunter2@' }, manifest.targets[1]],
    };
    const error = await attestAbTargets({ manifest: malformed, controlPlane: controlPlane() })
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('hunter2');
  });
});

describe('resetAbBranch', () => {
  it('refuses to reset a branch that is not in the attested manifest', async () => {
    await expect(resetAbBranch({ manifest: await attest(), branchId: 'br-production', apiKey: 'k' }))
      .rejects.toThrow(/not a designated/i);
  });

  it('posts a restore from the attested base and waits for the operation to finish', async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const send = restoreFetch({ operationIds: ['op-1'], statuses: ['running', 'finished'], calls });
    await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST') bodies.push(JSON.parse(String(init?.body ?? 'null')));
        return send(url, init);
      }) as unknown as typeof fetch,
    });
    expect(calls).toEqual([`POST ${RESTORE_URL}`, `GET ${OPERATION_URL('op-1')}`, `GET ${OPERATION_URL('op-1')}`]);
    expect(bodies).toEqual([{ source_branch_id: 'br-base' }]);
  });

  it('waits for every reported operation, not just the first', async () => {
    const calls: string[] = [];
    await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: restoreFetch({ operationIds: ['op-1', 'op-2'], statuses: ['finished'], calls }),
    });
    expect(calls).toEqual([`POST ${RESTORE_URL}`, `GET ${OPERATION_URL('op-1')}`, `GET ${OPERATION_URL('op-2')}`]);
  });

  it('throws when an operation ends in failed, because the branch was not reset', async () => {
    const calls: string[] = [];
    await expect(resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: restoreFetch({ operationIds: ['op-1'], statuses: ['running', 'failed'], calls }),
    })).rejects.toThrow(/reset operation ended with status failed/);
  });

  it.each(['error', 'cancelled'])('throws when an operation ends in %s', async (status) => {
    const calls: string[] = [];
    await expect(resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: restoreFetch({ operationIds: ['op-1'], statuses: [status], calls }),
    })).rejects.toThrow(new RegExp(`reset operation ended with status ${status}`));
  });

  // Restore reports the whole operation chain, and Neon marks a step it did not
  // need to perform `skipped`. Treating that as fatal aborted a reset that had
  // in fact succeeded, and said the branches might have been overwritten.
  it('accepts a skipped operation, because skipped means the step was unnecessary, not failed', async () => {
    const calls: string[] = [];
    await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: restoreFetch({ operationIds: ['op-1'], statuses: ['skipped'], calls }),
    });
    expect(calls).toEqual([`POST ${RESTORE_URL}`, `GET ${OPERATION_URL('op-1')}`]);
  });

  it('completes a restore whose compute sub-operation is skipped and whose restore finishes', async () => {
    const statusById: Record<string, string> = { 'op-restore': 'finished', 'op-suspend': 'skipped' };
    const calls: string[] = [];
    await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if ((init?.method ?? 'GET') === 'POST') {
          return new Response(JSON.stringify({
            branch: { id: 'br-a' },
            operations: [
              { id: 'op-restore', status: 'running', action: 'restore_branch' },
              { id: 'op-suspend', status: 'running', action: 'suspend_compute' },
            ],
          }), { status: 200 });
        }
        const id = url.slice(url.lastIndexOf('/') + 1);
        return new Response(JSON.stringify({ operation: { id, status: statusById[id] } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(calls).toEqual([`POST ${RESTORE_URL}`, `GET ${OPERATION_URL('op-restore')}`, `GET ${OPERATION_URL('op-suspend')}`]);
  });

  it('never puts the operation body in the failure error, because it can carry credentials', async () => {
    const calls: string[] = [];
    const error = await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'neon_api_key_secret', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: restoreFetch({ operationIds: ['op-1'], statuses: ['failed'], calls }),
    }).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain('sk-secret');
    expect((error as Error).message).not.toContain('neon_api_key_secret');
  });

  it('gives up within the injected timeout when an operation never finishes', async () => {
    const calls: string[] = [];
    const started = Date.now();
    await expect(resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 1, pollTimeoutMs: 25,
      fetchImpl: restoreFetch({ operationIds: ['op-1'], statuses: ['running'], calls }),
    })).rejects.toThrow(/did not finish within 25ms/);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls.length).toBeGreaterThan(1);
  });

  it('refuses a restore that reports no operations, because completion is then unknowable', async () => {
    await expect(resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    })).rejects.toThrow(/did not report any operations/);
  });

  it('reports only a status when an operation poll is refused', async () => {
    const error = await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: (async (_url: string, init?: RequestInit) => ((init?.method ?? 'GET') === 'POST'
        ? new Response(JSON.stringify({ operations: [{ id: 'op-1' }] }), { status: 200 })
        : new Response('{"message":"token sk-secret invalid"}', { status: 401 }))) as unknown as typeof fetch,
    }).catch((caught: Error) => caught);
    expect((error as Error).message).toMatch(/operation poll failed with status 401/);
    expect((error as Error).message).not.toContain('sk-secret');
  });

  it('refuses an unrecognized operation status rather than echoing it', async () => {
    await expect(resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1_000,
      fetchImpl: (async (_url: string, init?: RequestInit) => ((init?.method ?? 'GET') === 'POST'
        ? new Response(JSON.stringify({ operations: [{ id: 'op-1' }] }), { status: 200 })
        : new Response(JSON.stringify({ operation: { status: 'sk-secret' } }), { status: 200 }))) as unknown as typeof fetch,
    })).rejects.toThrow(/unrecognized status/);
  });

  it('raises a sanitized error when the control plane refuses', async () => {
    await expect(resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async () => new Response('{"message":"token sk-secret invalid"}', { status: 401 })) as unknown as typeof fetch,
    })).rejects.toThrow(/Neon control-plane reset failed/);
  });

  it('never puts the response body in the error, because it can carry credentials', async () => {
    const error = await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async () => new Response('{"message":"token sk-secret invalid"}', { status: 401 })) as unknown as typeof fetch,
    }).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain('sk-secret');
  });

  it('never puts the API key in the error either', async () => {
    const error = await resetAbBranch({
      manifest: await attest(), branchId: 'br-a', apiKey: 'neon_api_key_secret',
      fetchImpl: (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch,
    }).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain('neon_api_key_secret');
  });
});

describe('resetAbBranch attestation brand', () => {
  /**
   * The reviewer's attack: a manifest built through the real `parseAbManifest`
   * that names production as a side and dev as the base, never attested. It
   * must not compile, and must still be refused at runtime if the brand is cast
   * away.
   */
  const forged = parseAbManifest(JSON.stringify({
    projectId: 'shiny-cloud-34341469',
    baseBranchId: 'br-late-tooth-ahlsfgdb',
    targets: [
      { sideId: 'a', branchId: 'br-fragrant-brook-ahexgsek', endpointId: 'ep-prod', databaseUrl: 'postgresql://u:p@ep-prod.neon.tech/protocol_eval' },
      { sideId: 'b', branchId: 'br-b', endpointId: 'ep-b', databaseUrl: 'postgresql://u:p@ep-b.neon.tech/protocol_eval' },
    ],
  }));

  const neverCalled = (async () => {
    throw new Error('resetAbBranch must not reach the control plane');
  }) as unknown as typeof fetch;

  it('does not accept an unattested manifest at the type level', async () => {
    await expect(resetAbBranch({
      // @ts-expect-error - resetAbBranch takes only an AttestedAbManifest; a parsed
      // manifest is not one, so the forged-manifest attack cannot be compiled.
      manifest: forged,
      branchId: 'br-b', apiKey: 'k', fetchImpl: neverCalled,
    })).rejects.toThrow();
  });

  it('still refuses a branch outside the manifest when the brand is cast away', async () => {
    await expect(resetAbBranch({
      manifest: forged as AttestedAbManifest,
      branchId: 'br-production', apiKey: 'k', fetchImpl: neverCalled,
    })).rejects.toThrow(/not a designated/i);
  });
});

describe('strict historical quality manifest parsing and attestation', () => {
  it('parses only the exact v2 shape and canonicalizes child order', () => {
    const parsed = parseHistoricalQualityManifest(qualityManifestJson({
      targets: [qualityManifest.targets[1], qualityManifest.targets[0]],
    }));
    expect(parsed).toEqual(qualityManifest);
  });

  it.each([
    undefined,
    '{',
    manifestJson(),
    qualityManifestJson({ version: 1 }),
    qualityManifestJson({ extra: true }),
    qualityManifestJson({ baseReadReplica: { ...qualityManifest.baseReadReplica, extra: true } }),
    qualityManifestJson({ targets: [{ ...qualityManifest.targets[0], extra: true }, qualityManifest.targets[1]] }),
  ])('rejects missing, malformed, legacy, or non-exact quality manifest %p', (raw) => {
    expect(() => parseHistoricalQualityManifest(raw)).toThrow();
  });

  it.each([
    ['base branch reused by child', { targets: [{ ...qualityManifest.targets[0], branchId: 'br-base' }, qualityManifest.targets[1]] }],
    ['replica endpoint reused by child', { targets: [{ ...qualityManifest.targets[0], endpointId: 'ep-replica' }, qualityManifest.targets[1]] }],
    ['child endpoint duplicated', { targets: [qualityManifest.targets[0], { ...qualityManifest.targets[1], endpointId: 'ep-a' }] }],
    ['child branch duplicated', { targets: [qualityManifest.targets[0], { ...qualityManifest.targets[1], branchId: 'br-a' }] }],
    ['base URL reused by child', { targets: [{ ...qualityManifest.targets[0], databaseUrl: qualityManifest.baseReadReplica.databaseUrl }, qualityManifest.targets[1]] }],
  ])('rejects crossed or duplicate IDs/URLs: %s', (_label, override) => {
    expect(() => parseHistoricalQualityManifest(qualityManifestJson(override))).toThrow(/distinct|base|replica|URL/i);
  });

  it.each([
    'https://ep-replica.neon.tech/protocol_eval',
    'postgresql://reader:secret@example.com/protocol_eval',
    'postgresql://reader:secret@ep-replica.neon.tech/other',
    'postgresql://reader:secret@ep-replica.neon.tech:6543/protocol_eval',
    'not a url with hunter2',
  ])('rejects an unsafe base read-replica URL without echoing it: %s', (databaseUrl) => {
    let error: Error | undefined;
    try {
      parseHistoricalQualityManifest(qualityManifestJson({
        baseReadReplica: { ...qualityManifest.baseReadReplica, databaseUrl },
      }));
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain(databaseUrl);
    expect(error!.message).not.toContain('hunter2');
  });

  it('accepts the strict v2 manifest for quality attestation', async () => {
    await expect(attestHistoricalQualityTargets({ manifest: qualityManifest, controlPlane: qualityControlPlane() }))
      .resolves.toBeDefined();
  });

  it.each([
    ['writable replica', { endpointByRequestedBranch: { 'br-base': { id: 'ep-replica', branchId: 'br-base', host: 'ep-replica.neon.tech', type: 'read_write' as const } } }],
    ['read-only child', { endpointByRequestedBranch: { 'br-a': { id: 'ep-a', branchId: 'br-a', host: 'ep-a.neon.tech', type: 'read_only' as const } } }],
    ['replica owned by child', { endpointByRequestedBranch: { 'br-base': { id: 'ep-replica', branchId: 'br-a', host: 'ep-replica.neon.tech', type: 'read_only' as const } } }],
    ['crossed A/B endpoint', { endpointByRequestedBranch: { 'br-a': { id: 'ep-a', branchId: 'br-b', host: 'ep-a.neon.tech', type: 'read_write' as const } } }],
    ['crossed host', { endpointByRequestedBranch: { 'br-b': { id: 'ep-b', branchId: 'br-b', host: 'ep-a.neon.tech', type: 'read_write' as const } } }],
    ['wrong returned branch', { branchByRequestedId: { 'br-a': 'br-b' } }],
    ['wrong parent', { parentByBranch: { 'br-b': 'br-other' } }],
    ['primary base', { basePrimary: true }],
    ['wrong base name', { baseName: 'production' }],
  ])('rejects the %s role-crossing attack', async (_label, overrides) => {
    await expect(attestHistoricalQualityTargets({ manifest: qualityManifest, controlPlane: qualityControlPlane(overrides) }))
      .rejects.toThrow();
  });

  it('rejects a child endpoint ID returned on the base as a refresh endpoint role', async () => {
    const base = qualityControlPlane();
    await expect(attestHistoricalQualityTargets({
      manifest: qualityManifest,
      controlPlane: {
        ...base,
        listEndpoints: async (projectId, branchId) => branchId === 'br-base'
          ? [
            { id: 'ep-replica', branchId, host: 'ep-replica.neon.tech', type: 'read_only' },
            { id: 'ep-a', branchId, host: 'ep-refresh.neon.tech', type: 'read_write' },
          ]
          : base.listEndpoints(projectId, branchId),
      },
    })).rejects.toThrow();
  });

  it('never echoes a control-plane or URL secret on attestation failure', async () => {
    const secret = 'provider-body-hunter2';
    const error = await attestHistoricalQualityTargets({
      manifest: qualityManifest,
      controlPlane: {
        getBranch: async () => { throw new Error(secret); },
        listEndpoints: async () => { throw new Error('not reached'); },
      },
    }).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).not.toContain('replica-secret');
  });
});

describe('legacy A/B manifest compatibility', () => {
  it('continues accepting unversioned and version-1 legacy manifests', () => {
    expect(parseLegacyAbManifest(manifestJson())).toEqual(manifest);
    expect(parseLegacyAbManifest(manifestJson({ version: 1 }))).toEqual(manifest);
  });

  it('accepts v2 by projecting exactly the same two child targets', () => {
    expect(parseLegacyAbManifest(qualityManifestJson())).toEqual(manifest);
    expect(parseAbManifest(qualityManifestJson())).toEqual(manifest);
  });
});

describe('parseAbManifest', () => {
  it('refuses a manifest that does not name exactly two sides', () => {
    expect(() => parseAbManifest(JSON.stringify({ projectId: 'p', baseBranchId: 'b', targets: [] })))
      .toThrow(/exactly two/i);
  });

  it('refuses a missing manifest', () => {
    expect(() => parseAbManifest(undefined)).toThrow(/manifest/i);
  });

  it('refuses a manifest that is not valid JSON', () => {
    expect(() => parseAbManifest('{')).toThrow(/valid JSON/i);
  });

  it('accepts a well-formed manifest and orders the sides a then b', () => {
    const parsed = parseAbManifest(manifestJson({ targets: [manifest.targets[1], manifest.targets[0]] }));
    expect(parsed.targets.map((target) => target.sideId)).toEqual(['a', 'b']);
    expect(parsed.projectId).toBe('proj-1');
  });

  it('refuses a projectId of the wrong type instead of failing later on it', () => {
    expect(() => parseAbManifest(manifestJson({ projectId: 42 }))).toThrow(/projectId/);
  });

  it('refuses a target field of the wrong type instead of failing later on it', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], branchId: 7 }, manifest.targets[1]] })))
      .toThrow(/branchId/);
  });

  it('refuses a side id that is not a or b', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], sideId: 'c' }, manifest.targets[1]] })))
      .toThrow(/sideId/);
  });

  it('refuses two targets naming the same side', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [manifest.targets[0], { ...manifest.targets[1], sideId: 'a' }] })))
      .toThrow(/one side a and one side b/i);
  });

  it('refuses two sides pointed at the same branch', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [manifest.targets[0], { ...manifest.targets[1], branchId: 'br-a' }] })))
      .toThrow(/distinct/i);
  });

  it('refuses a side pointed at the base branch itself', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], branchId: 'br-base' }, manifest.targets[1]] })))
      .toThrow(/base branch/i);
  });

  it('refuses a databaseUrl that is not a Neon postgres URL', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], databaseUrl: 'https://evil.example.com/db' }, manifest.targets[1]] })))
      .toThrow(/databaseUrl/);
  });

  it('refuses a databaseUrl naming a database other than protocol_eval', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], databaseUrl: 'postgresql://u:p@ep-a.neon.tech/production' }, manifest.targets[1]] })))
      .toThrow(/must be exactly protocol_eval/);
  });

  it('refuses the URL shape the matrix bootstrap would have rejected', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], databaseUrl: 'postgresql://u:p@ep-a.neon.tech:6543/production?options=endpoint%3Dep-prod' }, manifest.targets[1]] })))
      .toThrow(/must be exactly protocol_eval/);
  });

  it('refuses a port other than 5432', () => {
    expect(() => parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], databaseUrl: 'postgresql://u:p@ep-a.neon.tech:6543/protocol_eval' }, manifest.targets[1]] })))
      .toThrow(/port must be exactly 5432/);
  });

  it('accepts the pooled Neon URL shape, which uses the default port', () => {
    const pooled = 'postgresql://u:p@ep-a-pooler.neon.tech:5432/protocol_eval?sslmode=require';
    const parsed = parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], databaseUrl: pooled }, manifest.targets[1]] }));
    expect(parsed.targets[0].databaseUrl).toBe(pooled);
  });

  it('never echoes a rejected databaseUrl, because it carries a password', () => {
    const error = ((): Error => {
      try {
        parseAbManifest(manifestJson({ targets: [{ ...manifest.targets[0], databaseUrl: 'https://u:hunter2@evil.example.com/db' }, manifest.targets[1]] }));
      } catch (caught) {
        return caught as Error;
      }
      throw new Error('expected parseAbManifest to reject');
    })();
    expect(error.message).not.toContain('hunter2');
  });
});
