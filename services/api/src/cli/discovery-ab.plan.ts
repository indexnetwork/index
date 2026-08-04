/**
 * Turns a selection and two configurations into slots.
 *
 * Selection is shared: two sides that ran different cases or different
 * repetition counts are not comparable, so it is one input, not two.
 */
import { assertAbEnvConfig, type AbEnvConfig } from './discovery-ab.flags';
import type { HistoricalMatrixFixture } from './discovery-env-matrix.shared';

export type AbSideId = 'a' | 'b';
export interface AbSide { id: AbSideId; config: AbEnvConfig }
export interface AbSlot { matrixCase: HistoricalMatrixFixture; side: AbSide; repetition: number }

/** Keys where the two sides disagree. Agreed keys explain no difference and are omitted. */
export function configDiff(a: AbEnvConfig, b: AbEnvConfig): Array<{ key: string; a: string | null; b: string | null }> {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((key) => a[key] !== b[key])
    .map((key) => ({ key, a: a[key] ?? null, b: b[key] ?? null }));
}

export function buildAbPlan(
  cases: readonly HistoricalMatrixFixture[],
  sides: readonly [AbSide, AbSide],
  repetitions: number,
): AbSlot[] {
  if (cases.length === 0) throw new Error('A discovery A/B run requires at least one case');
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error(`A discovery A/B run requires a positive repetition count (received ${repetitions})`);
  }
  for (const side of sides) assertAbEnvConfig(side.config);
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
