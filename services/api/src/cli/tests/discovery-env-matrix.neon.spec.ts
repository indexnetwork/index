import { describe, expect, it } from 'bun:test';

import { attestMatrixTargets, parseAttestedManifest, type NeonControlPlane } from '../discovery-env-matrix.neon';

const now = new Date('2026-07-29T12:00:00.000Z');
const base = { projectId: 'proj', branchId: 'br-base', databaseName: 'protocol_eval' };
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
  listEndpoints: async () => [{ id: 'ep-child', branchId: 'br-child', host: 'ep-child.neon.tech' }],
};

describe('Neon matrix control-plane attestation', () => {
  it('rejects a non-5432 target before a control-plane port can be created', () => {
    expect(() => parseAttestedManifest(JSON.stringify({ version: 1, base, children: [{ ...child, databaseUrl: 'postgresql://owner:secret@ep-child.neon.tech:6543/protocol_eval' }] }), [child.childKey])).toThrow('port must be exactly 5432');
  });

  it('binds project, base, child parent/expiry, endpoint, and URL host', async () => {
    const manifest = parseAttestedManifest(JSON.stringify({ version: 1, base, children: [child] }), [child.childKey]);
    await expect(attestMatrixTargets({ manifest, controlPlane, now })).resolves.toEqual(manifest);
  });

  it('rejects a child whose endpoint host differs from its URL', async () => {
    const manifest = parseAttestedManifest(JSON.stringify({ version: 1, base, children: [{ ...child, databaseUrl: 'postgresql://owner:secret@other.neon.tech:5432/protocol_eval' }] }), [child.childKey]);
    await expect(attestMatrixTargets({ manifest, controlPlane, now })).rejects.toThrow('endpoint host');
  });
});
