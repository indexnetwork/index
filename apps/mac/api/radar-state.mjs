/**
 * Helpers for Mac radar refresh: avoid list flinch when a poll returns the
 * same opportunities, and keep apply paths easy to unit-test.
 */

/**
 * @param {Array<Object>} prev
 * @param {Array<Object>} next
 */
export function sameRadarPeople(prev = [], next = []) {
  if (prev === next) return true;
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  if (prev.length !== next.length) return false;
  const byId = new Map(prev.map((p) => [p && p.id, p]));
  for (const person of next) {
    if (!person || !byId.has(person.id)) return false;
    const older = byId.get(person.id);
    if (
      older.status !== person.status
      || Number(older.score) !== Number(person.score)
      || older.name !== person.name
      || older.blurb !== person.blurb
    ) {
      return false;
    }
  }
  return true;
}

/**
 * @param {Array<Object>} prev
 * @param {Array<Object>} next
 */
export function applyRadarPeople(prev, next) {
  return sameRadarPeople(prev, next) ? prev : next;
}
