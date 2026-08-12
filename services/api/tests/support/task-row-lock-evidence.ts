import { sql, type SQL } from 'drizzle-orm';

export function taskRowBlockerPredicate(blockerPids: readonly number[]): SQL {
  if (blockerPids.length === 0) {
    throw new Error('At least one blocker PID is required');
  }

  return sql`(${sql.join(
    blockerPids.map((pid) => sql`${pid}::int = ANY(pg_blocking_pids(activity.pid))`),
    sql` OR `,
  )})`;
}
