import { createHash } from 'node:crypto';

export const BASE_FIXTURE_CORPUS_VERSION = 'historical-matrix-v2';
export const BASE_METADATA_KEY = 'discovery-env-matrix-base';
export const BASE_DECLARED_BRANCH = 'eval-discovery-base';

interface MatrixParticipantFixture {
  id: string;
  profileText: string;
  location: string;
  interests: readonly string[];
  skills: readonly string[];
  intent: { text: string };
}

export interface HistoricalMatrixFixture {
  id: string;
  description: string;
  networkContext: string;
  sourceUserId: string;
  expectedUserId: string;
  excludedUserIds: readonly string[];
  participants: readonly MatrixParticipantFixture[];
}

export interface BaseSeedPayload {
  fixtureCorpusVersion: typeof BASE_FIXTURE_CORPUS_VERSION;
  cases: Array<{
    id: string;
    description: string;
    sourceUserId: string;
    expectedUserId: string;
    excludedUserIds: string[];
    networkId: string;
  }>;
  users: Array<{
    id: string;
    email: string;
    name: string;
    intro: string;
    location: string;
  }>;
  networks: Array<{
    id: string;
    title: string;
    prompt: string;
  }>;
  memberships: Array<{
    networkId: string;
    userId: string;
  }>;
  intents: Array<{
    id: string;
    userId: string;
    networkId: string;
    payload: string;
    summary: string;
  }>;
}

export interface BaseMetadata {
  schemaMigrationFingerprint: string;
  fixtureFingerprint: string;
  fixtureCorpusVersion: string;
}

export interface BaseEnvironment {
  databaseUrl: URL;
  declaredBranch: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureId(kind: 'user' | 'network' | 'intent', source: string): string {
  return `eval-discovery-matrix-${kind}-${sha256(source).slice(0, 24)}`;
}

/**
 * Projects the fixture corpus into the only data the protected base may persist.
 * Audit-only metadata and report-only names are intentionally not represented
 * in this type or in any serialized seed row.
 */
export function baseSeedPayload(cases: readonly HistoricalMatrixFixture[]): BaseSeedPayload {
  const users = new Map<string, BaseSeedPayload['users'][number]>();
  const payload: BaseSeedPayload = {
    fixtureCorpusVersion: BASE_FIXTURE_CORPUS_VERSION,
    cases: [],
    users: [],
    networks: [],
    memberships: [],
    intents: [],
  };

  for (const matrixCase of cases) {
    const networkId = fixtureId('network', matrixCase.id);
    const participantIds = new Map(matrixCase.participants.map((participant) => [
      participant.id,
      fixtureId('user', participant.id),
    ]));
    const sourceUserId = participantIds.get(matrixCase.sourceUserId);
    const expectedUserId = participantIds.get(matrixCase.expectedUserId);
    if (!sourceUserId || !expectedUserId) {
      throw new Error(`${matrixCase.id}: fixture participant reference is missing`);
    }

    payload.cases.push({
      id: matrixCase.id,
      description: matrixCase.description,
      sourceUserId,
      expectedUserId,
      excludedUserIds: matrixCase.excludedUserIds.map((userId) => {
        const fixtureUserId = participantIds.get(userId);
        if (!fixtureUserId) throw new Error(`${matrixCase.id}: excluded fixture participant is missing`);
        return fixtureUserId;
      }),
      networkId,
    });
    payload.networks.push({
      id: networkId,
      title: `Discovery evaluation fixture ${payload.networks.length + 1}`,
      prompt: matrixCase.networkContext,
    });

    for (const participant of matrixCase.participants) {
      const userId = participantIds.get(participant.id)!;
      const user = {
        id: userId,
        email: `${userId}@fixture.invalid`,
        name: `Evaluation fixture participant ${sha256(participant.id).slice(0, 8)}`,
        intro: participant.profileText,
        location: participant.location,
      };
      const prior = users.get(userId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(user)) {
        throw new Error(`${matrixCase.id}: participant is inconsistent across fixtures`);
      }
      if (!prior) users.set(userId, user);

      payload.memberships.push({ networkId, userId });
      payload.intents.push({
        id: fixtureId('intent', `${matrixCase.id}:${participant.id}`),
        userId,
        networkId,
        payload: participant.intent.text,
        summary: 'Discovery evaluation fixture intent',
      });
    }
  }

  payload.users = [...users.values()];
  return payload;
}

/** Hashes the durable, model-safe seed projection rather than the audit fixture graph. */
export function computeFixtureFingerprint(cases: readonly HistoricalMatrixFixture[]): string {
  return sha256(JSON.stringify(baseSeedPayload(cases)));
}

/** Rejects every target except the manually attested protected evaluation base. */
export function assertBaseEnvironment(env: NodeJS.ProcessEnv): BaseEnvironment {
  if (env.DISCOVERY_ENV_MATRIX_BASE_CONFIRM !== '1') {
    throw new Error('Refusing to mutate: set DISCOVERY_ENV_MATRIX_BASE_CONFIRM=1');
  }
  if (env.TEST_DATABASE_SAFE !== '1') {
    throw new Error('Refusing to mutate: set TEST_DATABASE_SAFE=1 only for the protected evaluation database');
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Refusing to mutate: DATABASE_URL must be a valid Neon protocol_eval URL');
  }
  if (!databaseUrl.hostname.endsWith('.neon.tech')) {
    throw new Error(`Refusing non-Neon DATABASE_URL host: ${databaseUrl.hostname}`);
  }
  if (databaseUrl.pathname !== '/protocol_eval') {
    throw new Error(`Refusing to mutate: DATABASE_URL path must be exactly /protocol_eval (received ${databaseUrl.pathname || '/'})`);
  }

  const declaredBranch = env.DISCOVERY_ENV_MATRIX_BASE_BRANCH ?? '';
  if (declaredBranch !== BASE_DECLARED_BRANCH) {
    throw new Error(`Refusing to mutate: DISCOVERY_ENV_MATRIX_BASE_BRANCH must be exactly ${BASE_DECLARED_BRANCH}`);
  }

  return { databaseUrl, declaredBranch };
}

/** Fails closed when a child matrix run is not based on this exact schema and fixture corpus. */
export function verifyBaseContract(metadata: BaseMetadata | null | undefined, expected: BaseMetadata): void {
  if (!metadata) throw new Error('Discovery environment matrix base metadata is missing');
  if (metadata.schemaMigrationFingerprint !== expected.schemaMigrationFingerprint) {
    throw new Error('Discovery environment matrix base schema migration fingerprint mismatch');
  }
  if (metadata.fixtureFingerprint !== expected.fixtureFingerprint) {
    throw new Error('Discovery environment matrix base fixture fingerprint mismatch');
  }
  if (metadata.fixtureCorpusVersion !== expected.fixtureCorpusVersion) {
    throw new Error('Discovery environment matrix base fixture corpus version mismatch');
  }
}
