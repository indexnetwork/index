import type { HistoricalMatrixFixture } from './discovery-env-matrix.shared';

export const MATRIX_REPETITIONS = 3;
export const MATRIX_SLOT_COUNT = 75;
export const MATRIX_CHILD_BRANCH_PREFIX = 'eval-discovery-env-matrix-';

export interface MatrixRowEnvironment {
  id: string;
  allowedTypes: string;
  profileSource: string;
}

export interface MatrixPlanSlot<TCase = HistoricalMatrixFixture, TRow extends MatrixRowEnvironment = MatrixRowEnvironment> {
  matrixCase: TCase;
  row: TRow;
  repetition: number;
  /** One Neon child is required for this configuration/repetition cohort. */
  childKey: string;
}

export interface MatrixChildManifestEntry {
  childKey: string;
  branch: string;
  databaseUrl: string;
  baseBranch: string;
}

export interface MatrixChildManifest {
  children: MatrixChildManifestEntry[];
}

export function matrixChildKey(rowId: string, repetition: number): string {
  return `${rowId}-r${repetition + 1}`;
}

/** Plans every frozen case in an isolated row/repetition child cohort. */
export function buildMatrixPlan<TCase, TRow extends MatrixRowEnvironment>(
  cases: readonly TCase[],
  rows: readonly TRow[],
  repetitions: number = MATRIX_REPETITIONS,
): MatrixPlanSlot<TCase, TRow>[] {
  if (rows.length !== 5) throw new Error(`Discovery environment matrix requires exactly five rows (received ${rows.length})`);
  if (repetitions !== MATRIX_REPETITIONS) throw new Error(`Discovery environment matrix requires exactly ${MATRIX_REPETITIONS} repetitions`);
  const slots = cases.flatMap((matrixCase) => rows.flatMap((row) =>
    Array.from({ length: repetitions }, (_, repetition) => ({
      matrixCase,
      row,
      repetition,
      childKey: matrixChildKey(row.id, repetition),
    }))));
  if (slots.length !== MATRIX_SLOT_COUNT) {
    throw new Error(`Discovery environment matrix requires exactly ${MATRIX_SLOT_COUNT} slots (received ${slots.length})`);
  }
  return slots;
}

/** Restores both graph gates even when provider execution throws or times out. */
export async function withMatrixEnvironment<T>(row: MatrixRowEnvironment, run: () => Promise<T>): Promise<T> {
  const previousAllowedTypes = process.env.DISCOVERY_ALLOWED_TYPES;
  const previousProfileSource = process.env.DISCOVERY_PROFILE_SOURCE;
  process.env.DISCOVERY_ALLOWED_TYPES = row.allowedTypes;
  process.env.DISCOVERY_PROFILE_SOURCE = row.profileSource;
  try {
    return await run();
  } finally {
    if (previousAllowedTypes === undefined) delete process.env.DISCOVERY_ALLOWED_TYPES;
    else process.env.DISCOVERY_ALLOWED_TYPES = previousAllowedTypes;
    if (previousProfileSource === undefined) delete process.env.DISCOVERY_PROFILE_SOURCE;
    else process.env.DISCOVERY_PROFILE_SOURCE = previousProfileSource;
  }
}

/** Baselines are valid only when every requested matrix slot completed successfully. */
export function assertCompleteMatrix(execution: { requested: number; completed: number; failed: number }): void {
  if (execution.requested !== MATRIX_SLOT_COUNT || execution.completed !== MATRIX_SLOT_COUNT || execution.failed !== 0) {
    throw new Error(`Discovery environment matrix baseline requires ${MATRIX_SLOT_COUNT} complete slots (received ${execution.completed} complete, ${execution.failed} failed of ${execution.requested})`);
  }
}

export function assertMatrixEnvironment(env: NodeJS.ProcessEnv): { databaseUrl: URL; childBranch: string; baseBranch: string } {
  if (env.DISCOVERY_ENV_MATRIX_CONFIRM !== '1') {
    throw new Error('Refusing to mutate: set DISCOVERY_ENV_MATRIX_CONFIRM=1');
  }
  if (env.TEST_DATABASE_SAFE !== '1') {
    throw new Error('Refusing to mutate: set TEST_DATABASE_SAFE=1 only for a disposable evaluation child');
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
  const childBranch = env.DISCOVERY_ENV_MATRIX_CHILD_BRANCH ?? '';
  if (!childBranch.startsWith(MATRIX_CHILD_BRANCH_PREFIX)) {
    throw new Error(`Refusing to mutate: DISCOVERY_ENV_MATRIX_CHILD_BRANCH must start ${MATRIX_CHILD_BRANCH_PREFIX}`);
  }
  const baseBranch = env.DISCOVERY_ENV_MATRIX_BASE_BRANCH ?? '';
  if (baseBranch !== 'eval-discovery-base') {
    throw new Error('Refusing to mutate: DISCOVERY_ENV_MATRIX_BASE_BRANCH must be exactly eval-discovery-base');
  }
  return { databaseUrl, childBranch, baseBranch };
}

/** Validates the operator-provided, already-created child branches before any provider/database work. */
export function parseChildManifest(raw: string | undefined, expectedChildKeys: readonly string[]): MatrixChildManifest {
  if (!raw) throw new Error('DISCOVERY_ENV_MATRIX_CHILDREN must declare all matrix child branches');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('DISCOVERY_ENV_MATRIX_CHILDREN must be valid JSON');
  }
  const children = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { children?: unknown }).children)
      ? (parsed as { children: unknown[] }).children
      : null;
  if (!children) throw new Error('DISCOVERY_ENV_MATRIX_CHILDREN must be an array or { children: [...] }');
  const expected = new Set(expectedChildKeys);
  if (expected.size !== 15) throw new Error('Discovery environment matrix manifest requires exactly 15 child keys');
  if (children.length !== expected.size) throw new Error(`Discovery environment matrix manifest requires exactly ${expected.size} child branches`);
  const normalized = children.map((entry): MatrixChildManifestEntry => {
    if (!entry || typeof entry !== 'object') throw new Error('Discovery environment matrix child entry must be an object');
    const value = entry as Record<string, unknown>;
    if (typeof value.childKey !== 'string' || typeof value.branch !== 'string' || typeof value.databaseUrl !== 'string' || typeof value.baseBranch !== 'string') {
      throw new Error('Discovery environment matrix child entry requires childKey, branch, databaseUrl, and baseBranch strings');
    }
    if (!expected.has(value.childKey)) throw new Error(`Discovery environment matrix manifest has unknown child key: ${value.childKey}`);
    if (!value.branch.startsWith(MATRIX_CHILD_BRANCH_PREFIX)) throw new Error(`Discovery environment matrix child branch must start ${MATRIX_CHILD_BRANCH_PREFIX}`);
    if (value.baseBranch !== 'eval-discovery-base') throw new Error('Discovery environment matrix child baseBranch must be eval-discovery-base');
    const url = new URL(value.databaseUrl);
    if (!url.hostname.endsWith('.neon.tech') || url.pathname !== '/protocol_eval') {
      throw new Error(`Discovery environment matrix child ${value.childKey} must target a Neon /protocol_eval database`);
    }
    return { childKey: value.childKey, branch: value.branch, databaseUrl: value.databaseUrl, baseBranch: value.baseBranch };
  });
  if (new Set(normalized.map((child) => child.childKey)).size !== normalized.length) {
    throw new Error('Discovery environment matrix manifest has duplicate child keys');
  }
  if (new Set(normalized.map((child) => child.branch)).size !== normalized.length) {
    throw new Error('Discovery environment matrix manifest must use a different child branch per configuration/repetition');
  }
  if (new Set(normalized.map((child) => new URL(child.databaseUrl).toString())).size !== normalized.length) {
    throw new Error('Discovery environment matrix manifest must use a different normalized DATABASE_URL target per configuration/repetition');
  }
  return { children: normalized };
}
