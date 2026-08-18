import type { RadarCardItem } from '@/services/opportunities';

/**
 * The radar's "asking you first" state, as projected by the API
 * (`services/api/src/lib/opportunity/asking-first.projection.ts`).
 *
 * A pre-contact consultation: the agent stopped on its opening turn, before
 * writing anything to the counterparty, because a question only its client can
 * settle is blocking the decision. The park is the whole record — so the state
 * appears and disappears with it, and nothing here is stored client-side.
 */
export type AskingFirstState = NonNullable<RadarCardItem['askingFirst']>;

/**
 * Human phrasing for the consultation category, or null when there is nothing
 * honest to say.
 *
 * Only `unresolved_owner_constraint` is reachable before contact: the policy
 * fixes the category for a turn-0 park, because a pre-contact pause is by
 * construction a constraint the owner controls. The other categories describe
 * mid-flight consults, which never carry this state — so rather than invent
 * copy for a branch that cannot render, an unrecognized reason drops the row.
 */
export function askingFirstReasonLabel(reason: string | undefined): string | null {
  return reason === 'unresolved_owner_constraint'
    ? 'how your own criteria bound this search'
    : null;
}
