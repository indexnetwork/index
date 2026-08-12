import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { attestMatrixTargets, createNeonControlPlane, parseAttestedManifest, type NeonControlPlane } from '../discovery-env-matrix.neon';

const now = new Date('2026-07-29T12:00:00.000Z');
const base = { projectId: 'proj', branchId: 'br-base', endpointId: 'ep-base', databaseName: 'protocol_eval', databaseUrl: 'postgresql://owner:secret@ep-base.neon.tech:5432/protocol_eval' };
const child = {
  childKey: 'intent-only-r1',
  branchId: 'br-child',
  endpointId: 'ep-child',
  databaseName: 'protocol_eval',
  databaseUrl: 'postgresql://owner:secret@ep-child.neon.tech:5432/protocol_eval',
};

const controlPlane: NeonControlPlane = {
  getBranch: async (_projectId, branchId) => branchId === 'br-base'
    ? { id: 'br-base', name: 'eval-discovery-base', parentId: null, expiresAt: null, primary: false }
    : { id: 'br-child', name: 'eval-discovery-env-matrix-test', parentId: 'br-base', expiresAt: '2026-07-30T12:00:00.000Z', primary: false },
  listEndpoints: async (_projectId, branchId) => branchId === 'br-base'
    ? [{ id: 'ep-base', branchId: 'br-base', host: 'ep-base.neon.tech', type: 'read_write' }]
    : [{ id: 'ep-child', branchId: 'br-child', host: 'ep-child.neon.tech', type: 'read_write' }],
};

describe('Neon matrix control-plane attestation', () => {
  it('keeps mutable bootstraps dependency-free and redacts wrapper failures', async () => {
    for (const name of ['discovery-env-matrix.ts', 'discovery-env-matrix-base.ts', 'discovery-retrieval-smoke.ts']) {
      const source = await readFile(path.resolve(import.meta.dir, '..', name), 'utf8');
      expect(source).not.toContain("from '@indexnetwork/protocol'");
      expect(source).not.toContain('error.message');
      if (name === 'discovery-env-matrix-base.ts') {
        expect(source).toContain('Bun.spawn');
        expect(source).not.toContain("import('./discovery-env-matrix-base.main')");
      } else {
        expect(source).toContain("await import('");
      }
    }
    const baseRuntime = await readFile(path.resolve(import.meta.dir, '../discovery-env-matrix-base.runtime.ts'), 'utf8');
    expect(baseRuntime).toContain("await import('./discovery-env-matrix-base.main')");
  });
  it('strictly decodes endpoint type for writable-target consumers', async () => {
    const client = createNeonControlPlane('secret', (async () => new Response(JSON.stringify({
      endpoints: [{ id: 'ep-base', branch_id: 'br-base', host: 'ep-base.neon.tech', type: 'read_write' }],
    }), { status: 200 })) as typeof fetch);
    await expect(client.listEndpoints('proj', 'br-base')).resolves.toEqual([
      { id: 'ep-base', branchId: 'br-base', host: 'ep-base.neon.tech', type: 'read_write' },
    ]);

    const malformed = createNeonControlPlane('secret', (async () => new Response(JSON.stringify({
      endpoints: [{ id: 'ep-base', branch_id: 'br-base', host: 'ep-base.neon.tech', type: 'writer' }],
    }), { status: 200 })) as typeof fetch);
    await expect(malformed.listEndpoints('proj', 'br-base')).rejects.toThrow('invalid type');
  });

  it('creates only an explicitly read-only endpoint and strictly decodes the response', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const client = createNeonControlPlane('secret', (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({
        endpoint: { id: 'ep-replica', branch_id: 'br-base', host: 'ep-replica.neon.tech', type: 'read_only' },
      }), { status: 201 });
    }) as typeof fetch);

    await expect(client.createReadOnlyEndpoint('proj', 'br-base')).resolves.toEqual({
      id: 'ep-replica', branchId: 'br-base', host: 'ep-replica.neon.tech', type: 'read_only',
    });
    expect(calls).toEqual([{
      url: 'https://console.neon.tech/api/v2/projects/proj/endpoints',
      method: 'POST',
      body: { endpoint: { branch_id: 'br-base', type: 'read_only' } },
    }]);

    const malformed = createNeonControlPlane('secret', (async () => new Response(JSON.stringify({
      endpoint: { id: 'ep-replica', branch_id: 'br-base', host: 'ep-replica.neon.tech', type: 'reader' },
    }), { status: 201 })) as typeof fetch);
    await expect(malformed.createReadOnlyEndpoint('proj', 'br-base')).rejects.toThrow('invalid type');
  });

  it('rejects a non-5432 target before a control-plane port can be created', () => {
    expect(() => parseAttestedManifest(JSON.stringify({ version: 1, base, children: [{ ...child, databaseUrl: 'postgresql://owner:secret@ep-child.neon.tech:6543/protocol_eval' }] }), [child.childKey])).toThrow('port must be exactly 5432');
  });

  it('requires and binds the base endpoint and URL host', async () => {
    expect(() => parseAttestedManifest(JSON.stringify({ version: 1, base: { ...base, endpointId: undefined }, children: [child] }), [child.childKey])).toThrow('endpointId');
    const manifest = parseAttestedManifest(JSON.stringify({ version: 1, base, children: [child] }), [child.childKey]);
    await expect(attestMatrixTargets({ manifest, controlPlane, now })).resolves.toEqual(manifest);
  });

  it('keeps v1 matrix endpoint-type behavior unchanged and ignores read_only versus read_write', async () => {
    const manifest = parseAttestedManifest(JSON.stringify({ version: 1, base, children: [child] }), [child.childKey]);
    await expect(attestMatrixTargets({
      manifest,
      now,
      controlPlane: {
        ...controlPlane,
        listEndpoints: async (_projectId, branchId) => branchId === 'br-base'
          ? [{ id: 'ep-base', branchId: 'br-base', host: 'ep-base.neon.tech', type: 'read_only' }]
          : [{ id: 'ep-child', branchId: 'br-child', host: 'ep-child.neon.tech', type: 'read_only' }],
      },
    })).resolves.toEqual(manifest);
  });

  it('accepts only the exact pooled host corresponding to an attested endpoint', async () => {
    const pooledBase = { ...base, databaseUrl: 'postgresql://owner:secret@ep-base-pooler.neon.tech:5432/protocol_eval' };
    const pooledChild = { ...child, databaseUrl: 'postgresql://owner:secret@ep-child-pooler.neon.tech:5432/protocol_eval' };
    const manifest = parseAttestedManifest(JSON.stringify({ version: 1, base: pooledBase, children: [pooledChild] }), [child.childKey]);
    await expect(attestMatrixTargets({ manifest, controlPlane, now })).resolves.toEqual(manifest);
  });

  it('rejects deceptive or mismatched pooled endpoint hosts', async () => {
    for (const host of ['ep-child-pooler-other.neon.tech', 'ep-child-other-pooler.neon.tech', 'other-pooler.neon.tech']) {
      const manifest = parseAttestedManifest(JSON.stringify({ version: 1, base, children: [{ ...child, databaseUrl: `postgresql://owner:secret@${host}:5432/protocol_eval` }] }), [child.childKey]);
      await expect(attestMatrixTargets({ manifest, controlPlane, now })).rejects.toThrow('endpoint host');
    }
  });
});
