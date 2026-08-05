/**
 * Turns a selection and two configurations into slots.
 *
 * Selection is shared: two sides that ran different cases or different
 * repetition counts are not comparable, so it is one input, not two.
 */
import { assertAbEnvConfig, type AbEnvConfig } from './discovery.flags';
import type { HistoricalMatrixFixture } from './discovery-env-matrix.shared';

export type AbSideId = 'a' | 'b';
export interface AbSide { id: AbSideId; config: AbEnvConfig }
export interface AbSlot { matrixCase: HistoricalMatrixFixture; side: AbSide; repetition: number }

/**
 * Keys where the two sides disagree. Agreed keys explain no difference and are
 * omitted. A `null` means the key is absent on that side; `buildAbPlan` refuses
 * plans that would produce one, so every row of a planned run's diff compares a
 * real value against a real value.
 */
export function configDiff(a: AbEnvConfig, b: AbEnvConfig): Array<{ key: string; a: string | null; b: string | null }> {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((key) => a[key] !== b[key])
    .map((key) => ({ key, a: a[key] ?? null, b: b[key] ?? null }));
}

/**
 * Two sides must be two sides: one `a`, one `b`, in that order.
 *
 * Side ids arrive from externally supplied JSON, not only from local callers.
 * Two sides sharing an id collapse into a single row downstream (the runner
 * keys rows by `slot.side.id` and the report aggregates by it), so the artifact
 * would claim a comparison that was never made. A reversed pair is just as
 * dishonest in the quieter way: `configDiff` is called as (sides[0], sides[1]),
 * so side b's values would be filed under the artifact's `a` column.
 */
function assertOrderedDistinctSides(sides: readonly [AbSide, AbSide]): void {
  if (sides[0].id !== 'a' || sides[1].id !== 'b') {
    throw new Error(
      `A discovery run requires side 'a' first and side 'b' second `
      + `(received '${sides[0].id}' then '${sides[1].id}'); two sides sharing an id collapse into one row `
      + `downstream, and a reversed pair reports side b's values under the artifact's a column`,
    );
  }
}

/**
 * Both sides must declare the same key set, so every diff row compares a real
 * value against a real value.
 *
 * A key set on one side only reads as `null` on the other, and `null` means
 * "unset" — which means the graph applies its *own* default, a default that can
 * equal the other side's explicit value. `{}` against
 * `{ DISCOVERY_ALLOWED_TYPES: 'intent,profile' }` is the worst case: the default
 * *is* `intent,profile` (packages/protocol/src/opportunity/discovery.env.ts:46),
 * so both sides behave identically, yet the run is accepted and whatever noise
 * it measures is attributed to that flag. That is exactly what the
 * identical-configuration guard exists to prevent, arriving through the side
 * door.
 *
 * Requiring symmetry removes the ambiguity at its root rather than guessing
 * defaults here — a copy of nine defaults is the same fiction one level up.
 * It is workable because every flag's unset behaviour is reachable by a value
 * an operator can type (defaults verified at their read sites: ALLOWED_TYPES
 * `intent,profile`, PROFILE_SOURCE `premise`, CONTEXT_TO_INTENT any non-`0`,
 * REJECTION_COOLDOWN_DAYS `7`, SOURCE_PREMISE_LIMIT `40`,
 * INCLUDE_OTHER_INTENTS `true`, MAX_TURNS_CHAT `4`, MAX_TURNS_AMBIENT `6`,
 * RUN_OPPORTUNITY_EVAL_IN_PARALLEL `false`).
 */
function assertSymmetricKeySets(sides: readonly [AbSide, AbSide]): void {
  for (const [side, other] of [[sides[0], sides[1]], [sides[1], sides[0]]] as const) {
    for (const key of Object.keys(side.config).sort()) {
      if (Object.prototype.hasOwnProperty.call(other.config, key)) continue;
      throw new Error(
        `${key} is set on side ${side.id} but omitted on side ${other.id}; an omitted flag takes the `
        + `graph's own default, which may equal side ${side.id}'s value and make the run measure nothing. `
        + `State ${key} explicitly on both sides so the comparison is explicit versus explicit`,
      );
    }
  }
}

export function buildAbPlan(
  cases: readonly HistoricalMatrixFixture[],
  sides: readonly [AbSide, AbSide],
  repetitions: number,
): AbSlot[] {
  assertOrderedDistinctSides(sides);
  if (cases.length === 0) throw new Error('A discovery run requires at least one case');
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error(`A discovery run requires a positive repetition count (received ${repetitions})`);
  }
  for (const side of sides) assertAbEnvConfig(side.config);
  assertSymmetricKeySets(sides);
  const differences = configDiff(sides[0].config, sides[1].config);
  if (differences.length === 0) {
    throw new Error('Both sides have identical configurations; the run would measure noise, not a difference');
  }
  const slots: AbSlot[] = [];
  for (const matrixCase of cases) {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      for (const side of sides) slots.push({ matrixCase, side, repetition });
    }
  }
  return slots;
}
