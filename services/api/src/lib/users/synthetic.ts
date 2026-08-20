/**
 * Synthetic principals — seed-persona accounts with nobody behind them.
 *
 * The seed CLIs (`src/cli/db-seed.ts`, `db-seed-sandbox.ts`, `test-data.ts`,
 * `sandbox-personas.ts`) create every persona on a `.test` email domain, which
 * RFC 2606 reserves for exactly this: `.test` is permanently unresolvable in
 * the public DNS, so no address under it can ever belong to a deliverable
 * mailbox and no real user can hold one. That makes the TLD a safe durable
 * marker by construction — no `users.is_synthetic` column, and no feature flag.
 *
 * The operational fact this establishes is *unreachability*: a principal whose
 * agent asks them something will never receive an answer. Consumers therefore
 * speak of an "unreachable principal" rather than a synthetic one — the same
 * truth, stated in terms that would still hold if the reason changed (a
 * suspended or deleted account, say), and stated without leaking test framing
 * into anything a counterparty's user might read.
 *
 * A seed persona is only unreachable while nobody is behind it. The moment a
 * tester signs in as one, there IS someone to answer — the question routes to
 * whoever is driving the account — so an inhabited seed is reachable, and the
 * rule is:
 *
 *     unreachable(user) = isSyntheticUserEmail(user.email)
 *                         AND NOT hasActiveSession(user.id)
 *
 * "Active session" is {@link ACTIVE_SESSION_RULE}: any row in `sessions` for
 * the user whose `expires_at` is still in the future. Better Auth issues
 * seven-day sessions and refreshes `expires_at` on use, and sign-out deletes
 * the row, so an unexpired session means "someone set this persona up to be
 * driven this week and has not left" — which is exactly the population whose
 * questions deserve to land. A tester who signed in yesterday still wants the
 * question today; no recency window tighter than the session's own lifetime
 * is applied.
 *
 * This is the single definition. Every consumer goes through it.
 */
import { log } from '../log';

const logger = log.lib.from('users/synthetic');

/**
 * The one liveness rule a seed persona's session must satisfy to count as
 * inhabited. Stated as a constant so the choice is named, not scattered:
 * `unexpired` means `sessions.expires_at > now()` and nothing stricter.
 * Readers implementing {@link SyntheticPrincipalReader.hasActiveSession}
 * encode this exact predicate.
 */
export const ACTIVE_SESSION_RULE = 'unexpired' as const;

/**
 * Whether this address belongs to a seed persona: true iff the domain's final
 * label is exactly `test`, case-insensitively, with an optional FQDN trailing
 * dot tolerated.
 *
 * The final label is the whole test. `test@test.example.com` is a real address
 * at a real domain whose `test` label is not final, and must stay reachable.
 */
export function isSyntheticUserEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  if (domain.length === 0) return false;
  return domain.split('.').at(-1) === 'test';
}

/** The narrow reads {@link resolvePrincipalUnreachable} needs. */
export interface SyntheticPrincipalReader {
  getUser(userId: string): Promise<{ email: string | null } | null>;
  /**
   * Whether the user holds a session satisfying {@link ACTIVE_SESSION_RULE}.
   * Only ever consulted for seed personas; real users never reach it.
   */
  hasActiveSession(userId: string): Promise<boolean>;
}

/**
 * Whether this principal can be consulted at all during a negotiation.
 *
 * Two reads, two populations, two opposite failure directions — both correct:
 *
 * - The user read fails OPEN. An unresolvable user, a missing email, or a
 *   failed read all report *reachable*. Real users are the default, and
 *   wrongly calling a real principal unreachable would silently stop their
 *   own agent from ever asking them anything, while wrongly calling a seed
 *   persona reachable only restores pre-#1459 behaviour.
 * - The session read fails CLOSED, and is only made for `.test` users. A seed
 *   persona whose session read fails reports *unreachable*: wrongly asking a
 *   persona nobody inhabits rots a question in a DM no one opens, while
 *   wrongly silencing an inhabited persona merely restores yesterday's
 *   behaviour. Real users short-circuit before the sessions table is touched,
 *   so the common path costs one read and a sessions outage cannot affect a
 *   real principal.
 */
export async function resolvePrincipalUnreachable(
  userId: string,
  reader?: SyntheticPrincipalReader,
): Promise<boolean> {
  const resolved = reader
    ?? (await import('../../adapters/database.adapter')).conversationDatabaseAdapter;

  let synthetic: boolean;
  try {
    const user = await resolved.getUser(userId);
    synthetic = isSyntheticUserEmail(user?.email);
  } catch (err) {
    logger.warn('Principal reachability read failed; treating principal as reachable', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  if (!synthetic) return false;

  try {
    return !(await resolved.hasActiveSession(userId));
  } catch (err) {
    logger.warn('Seed-persona session read failed; treating principal as unreachable', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
