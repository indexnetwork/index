/**
 * The discovery harness's fail-closed environment gate.
 *
 * It is the A/B counterpart of `assertMatrixEnvironment`, and it checks the
 * same five things: an explicit confirm variable, the disposable-database
 * marker, a Neon host, exactly the `protocol_eval` database, and the branch the
 * process is actually pointed at. The graph writes opportunities and
 * negotiation tasks, so nothing here is advisory.
 *
 * It lives in its own dependency-free module rather than in
 * `discovery.main.ts` because the bootstrap must refuse an unconfirmed run
 * *before* importing anything that could compose a database singleton, and
 * `discovery.main.ts` reaches `@indexnetwork/protocol` through its very
 * first import. A gate you can only reach after loading the graph is not a
 * gate.
 *
 * Errors never echo `DATABASE_URL`, which carries a password; only the hostname
 * and the offending field name are reported, exactly as the matrix gate does.
 */
import { AB_BRANCH_NAMES } from './discovery.neon';

import type { AbSideId } from './discovery.plan';

/**
 * A refusal the operator is meant to read.
 *
 * The bootstrap prints a deliberately generic message for every other failure,
 * because provider and control-plane errors can carry credentials. Gate
 * refusals are authored here in full and name only environment variable names,
 * so they are safe to print and useless unless printed: "set
 * DISCOVERY_CONFIRM=1" is the whole point of the gate.
 */
export class AbGateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AbGateError';
  }
}

/** The branch label the bootstrap derives from the attested manifest for a child. */
export const AB_SIDE_BRANCH_ENV = 'DISCOVERY_SIDE_BRANCH';

export interface AbSideEnvironment {
  databaseUrl: URL;
  branch: string;
}

/**
 * The operator attestation every A/B process requires, parent included.
 *
 * The parent composes no database of its own, but it resets two branches and
 * spawns two processes that do, so it is gated by the same variables rather
 * than by the children it starts. `NEON_API_KEY` is required here rather than
 * where it is used because every A/B process attests its targets before
 * importing anything that touches a database, and a missing key would
 * otherwise surface as an attestation refusal that says nothing about the key.
 */
export function assertAbConfirmation(env: NodeJS.ProcessEnv): void {
  if (env.DISCOVERY_CONFIRM !== '1') {
    throw new AbGateError('Refusing to mutate: set DISCOVERY_CONFIRM=1');
  }
  if (env.TEST_DATABASE_SAFE !== '1') {
    throw new AbGateError('Refusing to mutate: set TEST_DATABASE_SAFE=1 only for a disposable evaluation branch');
  }
  if ((env.NEON_API_KEY ?? '') === '') {
    throw new AbGateError('Refusing to run: NEON_API_KEY is required to attest both A/B branches before anything runs');
  }
  // Presence only. What a manifest must contain is `parseAbManifest`'s contract,
  // and restating any of it here would be a second copy to drift from.
  if ((env.DISCOVERY_TARGETS ?? '').trim() === '') {
    throw new AbGateError('Refusing to run: DISCOVERY_TARGETS must declare the two designated A/B branches');
  }
}

/**
 * Everything above, plus proof that this process is pointed at its own side's
 * designated A/B branch.
 *
 * The branch label is compared against `AB_BRANCH_NAMES[sideId]` exactly, so a
 * child that was handed side b's URL under side a's flag is refused before it
 * composes a database singleton — the artifact would otherwise attribute side
 * b's branch to side a's configuration.
 */
export function assertAbSideEnvironment(env: NodeJS.ProcessEnv, sideId: AbSideId): AbSideEnvironment {
  assertAbConfirmation(env);
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new AbGateError('Refusing to mutate: DATABASE_URL must be a valid Neon protocol_eval URL');
  }
  if (databaseUrl.protocol !== 'postgres:' && databaseUrl.protocol !== 'postgresql:') {
    throw new AbGateError('Refusing to mutate: DATABASE_URL must use postgres');
  }
  if (!databaseUrl.hostname.endsWith('.neon.tech')) {
    throw new AbGateError(`Refusing non-Neon DATABASE_URL host: ${databaseUrl.hostname}`);
  }
  if (databaseUrl.pathname !== '/protocol_eval') {
    throw new AbGateError(`Refusing to mutate: DATABASE_URL path must be exactly /protocol_eval (received ${databaseUrl.pathname || '/'})`);
  }
  if (databaseUrl.port && databaseUrl.port !== '5432') {
    throw new AbGateError(`Refusing to mutate: DATABASE_URL port must be exactly 5432 (received ${databaseUrl.port})`);
  }
  const branch = env[AB_SIDE_BRANCH_ENV] ?? '';
  if (branch !== AB_BRANCH_NAMES[sideId]) {
    throw new AbGateError(`Refusing to mutate: ${AB_SIDE_BRANCH_ENV} must be exactly ${AB_BRANCH_NAMES[sideId]} for side ${sideId}`);
  }
  return { databaseUrl, branch };
}
