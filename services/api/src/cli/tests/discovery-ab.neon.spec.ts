import { describe, expect, it } from 'bun:test';

import { attestAbTargets, parseAbManifest, resetAbBranch, type AbManifest } from '../discovery-ab.neon';
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
    { id: `ep-${branchId.slice(3)}`, branchId, host: `ep-${branchId.slice(3)}.neon.tech` },
  ],
});

const manifestJson = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  projectId: 'proj-1',
  baseBranchId: 'br-base',
  targets: manifest.targets,
  ...overrides,
});

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
    await expect(resetAbBranch({ manifest, branchId: 'br-production', apiKey: 'k' }))
      .rejects.toThrow(/not a designated/i);
  });

  it('posts a restore from the attested base for an attested A/B branch', async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    await resetAbBranch({
      manifest, branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        bodies.push(JSON.parse(String(init?.body ?? 'null')));
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(calls).toEqual(['POST https://console.neon.tech/api/v2/projects/proj-1/branches/br-a/restore']);
    expect(bodies).toEqual([{ source_branch_id: 'br-base' }]);
  });

  it('raises a sanitized error when the control plane refuses', async () => {
    await expect(resetAbBranch({
      manifest, branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async () => new Response('{"message":"token sk-secret invalid"}', { status: 401 })) as unknown as typeof fetch,
    })).rejects.toThrow(/Neon control-plane reset failed/);
  });

  it('never puts the response body in the error, because it can carry credentials', async () => {
    const error = await resetAbBranch({
      manifest, branchId: 'br-a', apiKey: 'k',
      fetchImpl: (async () => new Response('{"message":"token sk-secret invalid"}', { status: 401 })) as unknown as typeof fetch,
    }).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain('sk-secret');
  });

  it('never puts the API key in the error either', async () => {
    const error = await resetAbBranch({
      manifest, branchId: 'br-a', apiKey: 'neon_api_key_secret',
      fetchImpl: (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch,
    }).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain('neon_api_key_secret');
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
