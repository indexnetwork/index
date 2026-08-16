/**
 * Turns a selection and one or two configurations into slots.
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
 * What a run compares, or measures.
 *
 * A pair is the comparison this harness was built for. A single side is one
 * configuration measured against the corpus, which is a scorecard and not a
 * comparison — it produces a pass rate, and the operator supplies the reference
 * themselves (a previous run, an expectation, a hypothesis). The two shapes are
 * one type rather than two code paths because everything downstream of planning
 * — slot ids, scoring, child supervision, artifact assembly — is per side and
 * does not care how many sides there are.
 */
export type AbSides = readonly [AbSide] | readonly [AbSide, AbSide];

/** True when this run compares two configurations rather than measuring one. */
export function isAbPair(sides: AbSides): sides is readonly [AbSide, AbSide] {
  return sides.length === 2;
}

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
 * A single-sided run must be side `a`.
 *
 * Not cosmetic: the parent picks the branch to reset by looking up the side id
 * in the manifest, the child asserts it is composed against the database its
 * own side's manifest entry declares, and `AB_BRANCH_NAMES[sideId]` names the
 * branch in every message. A lone side `b` would be coherent, but it would mean
 * two ways to express one thing and a second branch to keep seeded for no gain.
 */
function assertSingleSideIsA(side: AbSide): void {
  if (side.id !== 'a') {
    throw new Error(
      `A single-configuration discovery run uses side 'a' (received '${side.id}'); `
      + 'side b exists to be compared against side a, so a lone b names no comparison',
    );
  }
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
      `A discovery comparison requires side 'a' first and side 'b' second `
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
 * *is* `intent,profile` (packages/protocol/src/opportunities/discovery.env.ts:46),
 * so both sides behave identically, yet the run is accepted and whatever noise
 * it measures is attributed to that flag. That is exactly what the
 * identical-configuration guard exists to prevent, arriving through the side
 * door.
 *
 * Requiring symmetry removes the ambiguity at its root rather than guessing
 * defaults here — a copy of the graph's defaults is the same fiction one level
 * up. It is workable because every flag's unset behaviour is reachable by a
 * value an operator can type.
 *
 * This is a rule about a *comparison*, so it applies only to a pair. A single
 * side has nothing to be asymmetric with: every key it omits takes the graph's
 * default, and the artifact records exactly the keys it set, so there is no
 * second column for an omission to be misattributed to.
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
  sides: AbSides,
  repetitions: number,
): AbSlot[] {
  if (isAbPair(sides)) {
    assertOrderedDistinctSides(sides);
  } else {
    assertSingleSideIsA(sides[0]);
  }
  if (cases.length === 0) throw new Error('A discovery run requires at least one case');
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error(`A discovery run requires a positive repetition count (received ${repetitions})`);
  }
  for (const side of sides) assertAbEnvConfig(side.config);
  // Symmetry and difference are properties of a comparison. Applied to a single
  // side they would refuse every valid run: there is no other side to match
  // keys with, and "identical configurations" needs two configurations.
  if (isAbPair(sides)) {
    assertSymmetricKeySets(sides);
    const differences = configDiff(sides[0].config, sides[1].config);
    if (differences.length === 0) {
      throw new Error('Both sides have identical configurations; the run would measure noise, not a difference');
    }
  }
  const slots: AbSlot[] = [];
  for (const matrixCase of cases) {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      for (const side of sides) slots.push({ matrixCase, side, repetition });
    }
  }
  return slots;
}
