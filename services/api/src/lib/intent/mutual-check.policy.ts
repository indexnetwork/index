import type { AssignmentVisibility } from '../../schemas/database.schema';

/** Which assignment levels a saved intent is checked against in one network. */
export function poolFor(visibility: AssignmentVisibility): AssignmentVisibility[] {
  return visibility === 'mutuals_only' ? ['networks_only', 'mutuals_only'] : ['mutuals_only'];
}

/** A pair opens only when both directions say yes. */
export function bothYes(a: boolean, b: boolean): boolean {
  return a && b;
}
