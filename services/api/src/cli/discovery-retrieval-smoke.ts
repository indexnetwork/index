#!/usr/bin/env bun
/** Dependency-free smoke bootstrap; no DB/provider module is imported before attestation. */
import { createNeonControlPlane, type NeonControlPlane } from './discovery-env-matrix.neon';

type SmokeTarget = { projectId: string; branchId: string; parentBranchId: string; endpointId: string; databaseUrl: string };
async function attest(target: SmokeTarget, controlPlane: NeonControlPlane): Promise<void> {
  const url = new URL(target.databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/protocol_eval' || (url.port && url.port !== '5432') || !url.hostname.endsWith('.neon.tech')) throw new Error('Smoke target must be an exact Neon protocol_eval target');
  const [branch, parent] = await Promise.all([controlPlane.getBranch(target.projectId, target.branchId), controlPlane.getBranch(target.projectId, target.parentBranchId)]);
  if (parent.id !== target.parentBranchId || parent.name !== 'eval-discovery-base' || parent.primary) throw new Error('Smoke parent is not the protected evaluation base');
  if (branch.id !== target.branchId || !branch.name.startsWith('eval-discovery-retrieval-') || branch.parentId !== parent.id || branch.primary || !branch.expiresAt || Date.parse(branch.expiresAt) <= Date.now()) throw new Error('Smoke branch is not a live disposable child of the protected base');
  const endpoint = (await controlPlane.listEndpoints(target.projectId, target.branchId)).find((value) => value.id === target.endpointId);
  if (!endpoint || endpoint.branchId !== branch.id || endpoint.host !== url.hostname) throw new Error('Smoke endpoint does not match DATABASE_URL');
}
async function main(): Promise<void> {
  let target: SmokeTarget;
  try { target = JSON.parse(process.env.DISCOVERY_RETRIEVAL_SMOKE_TARGET ?? ''); } catch { throw new Error('DISCOVERY_RETRIEVAL_SMOKE_TARGET must be valid JSON'); }
  await attest(target!, createNeonControlPlane(process.env.NEON_API_KEY ?? ''));
  process.env.DATABASE_URL = target!.databaseUrl;
  await (await import('./discovery-retrieval-smoke.main')).main();
}
if (import.meta.main) main().catch(() => { console.error('Discovery retrieval smoke failed'); process.exitCode = 1; });
