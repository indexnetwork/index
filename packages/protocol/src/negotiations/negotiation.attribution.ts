import type { NegotiationTurn } from "./negotiation.state.js";

/**
 * Prior-dialogue attribution (IND-569).
 *
 * On a continuation negotiation the negotiator agent is seeded with every
 * prior turn this pair exchanged — across ALL past opportunities on the shared
 * DM. Rendered flat, the agent cannot tell which turns belonged to a different,
 * already-concluded opportunity versus the one it is negotiating right now.
 * That undifferentiated context lets stale turns from another opportunity read
 * as if they were part of the current exchange (and, since they cross a trust
 * boundary into the prompt, as if they were current instructions).
 *
 * This module groups seeded prior turns by their originating opportunity so the
 * prompt can label each earlier negotiation explicitly, keep legacy
 * unattributed turns in their own block, and separate the current opportunity's
 * own turns. The grouping is pure (DB access is injected via `resolveTask`) so
 * it is unit-testable without a live database.
 */

/** Best-effort attribution metadata for one prior negotiation task. */
export interface TaskAttribution {
  /** The opportunity the task negotiated (grouping key). Null when unresolved. */
  opportunityId: string | null;
  /** Human-facing intent/opportunity title for the header (best-effort). */
  opportunityTitle: string | null;
  /** Coarse conclusion label (e.g. `accepted` | `declined` | `not pursued`). */
  outcome: string | null;
  /** ISO timestamp the prior negotiation concluded (task.updatedAt), or null. */
  concludedAt: string | null;
}

/** A concluded prior negotiation on a DIFFERENT opportunity with this counterparty. */
export interface EarlierNegotiationGroup {
  /** Opportunity id (grouping key). */
  opportunityId: string;
  /** Human-facing intent/opportunity title; null when it could not be resolved. */
  opportunityTitle: string | null;
  /** Coarse conclusion label; null when it could not be resolved. */
  outcome: string | null;
  /** ISO timestamp the prior negotiation concluded, or null. */
  concludedAt: string | null;
  /** The turns exchanged in that earlier negotiation, in order. */
  turns: NegotiationTurn[];
}

/**
 * The immutable slice of attributed prior dialogue derived once from the
 * seeded prior messages (init node): everything that existed before this
 * session's task. `currentSeeded` holds prior turns that belong to the SAME
 * opportunity now being negotiated (e.g. an earlier session of it), which must
 * join the current block rather than an earlier one.
 */
export interface SeededAttribution {
  earlier: EarlierNegotiationGroup[];
  unattributed: NegotiationTurn[];
  currentSeeded: NegotiationTurn[];
}

/**
 * Attributed prior dialogue passed to the negotiator agent and the outreach
 * screener (IND-569). `current` combines same-opportunity seeded turns with
 * the turns exchanged in this session.
 */
export interface AttributedPriorDialogue {
  /** Prior concluded negotiations on OTHER opportunities, grouped + labeled. */
  earlier: EarlierNegotiationGroup[];
  /** Legacy/unattributed prior turns (null task_id) — never mixed into current. */
  unattributed: NegotiationTurn[];
  /** The current opportunity's own turns (same-opportunity seeded + this session). */
  current: NegotiationTurn[];
}

/** True when the attributed dialogue carries no turns in any block. */
export function attributedDialogueIsEmpty(d: AttributedPriorDialogue): boolean {
  return d.current.length === 0
    && d.unattributed.length === 0
    && d.earlier.every((g) => g.turns.length === 0);
}

/**
 * Partition seeded prior turns into earlier-opportunity groups, an unattributed
 * block, and same-opportunity turns. Pure over the injected `resolveTask` — the
 * caller supplies a DB-backed resolver (graph) or a fake (tests). Any task that
 * fails to resolve, or carries no opportunity, degrades to the unattributed
 * block so an attribution failure NEVER leaks a stale turn into the current
 * opportunity's context.
 */
export async function buildSeededAttribution(
  entries: Array<{ taskId?: string | null; turn: NegotiationTurn }>,
  currentOpportunityId: string,
  resolveTask: (taskId: string) => Promise<TaskAttribution | null>,
): Promise<SeededAttribution> {
  const distinctTaskIds = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.taskId === "string" && entry.taskId.length > 0) distinctTaskIds.add(entry.taskId);
  }

  const metaByTask = new Map<string, TaskAttribution | null>();
  await Promise.all(
    [...distinctTaskIds].map(async (taskId) => {
      try {
        metaByTask.set(taskId, await resolveTask(taskId));
      } catch {
        metaByTask.set(taskId, null);
      }
    }),
  );

  const earlierByOpp = new Map<string, EarlierNegotiationGroup>();
  const unattributed: NegotiationTurn[] = [];
  const currentSeeded: NegotiationTurn[] = [];

  for (const { taskId, turn } of entries) {
    const meta = typeof taskId === "string" && taskId.length > 0 ? metaByTask.get(taskId) ?? null : null;
    const oppId = meta?.opportunityId ?? null;

    // No attribution at all → unattributed block (never mixed into current).
    if (!oppId) {
      unattributed.push(turn);
      continue;
    }

    // Same opportunity as the one under negotiation → part of the current block.
    if (currentOpportunityId && oppId === currentOpportunityId) {
      currentSeeded.push(turn);
      continue;
    }

    let group = earlierByOpp.get(oppId);
    if (!group) {
      group = {
        opportunityId: oppId,
        opportunityTitle: meta?.opportunityTitle ?? null,
        outcome: meta?.outcome ?? null,
        concludedAt: meta?.concludedAt ?? null,
        turns: [],
      };
      earlierByOpp.set(oppId, group);
    }
    group.turns.push(turn);
  }

  return { earlier: [...earlierByOpp.values()], unattributed, currentSeeded };
}

/** Combine the immutable seeded attribution with this session's own turns. */
export function combineAttributedDialogue(
  seeded: SeededAttribution,
  currentSessionTurns: NegotiationTurn[],
): AttributedPriorDialogue {
  return {
    earlier: seeded.earlier,
    unattributed: seeded.unattributed,
    current: [...seeded.currentSeeded, ...currentSessionTurns],
  };
}

/** ISO timestamp → `YYYY-MM-DD`, or null when unparseable. */
function formatConcludedDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Build the labeled header for an earlier-opportunity block. */
function earlierHeader(group: EarlierNegotiationGroup): string {
  const title = group.opportunityTitle && group.opportunityTitle.trim().length > 0
    ? `"${group.opportunityTitle.trim()}"`
    : "(untitled)";
  const outcome = group.outcome && group.outcome.trim().length > 0 ? group.outcome.trim() : "outcome unknown";
  const date = formatConcludedDate(group.concludedAt);
  const datePart = date ? ` on ${date}` : "";
  return `[Earlier negotiation — opportunity: ${title} — concluded: ${outcome}${datePart}]`;
}

/**
 * Render the attributed prior dialogue into labeled prompt blocks. `formatTurn`
 * lets each surface (negotiator agent / screener) keep its own per-turn line
 * format while sharing the block structure. Only non-empty blocks are emitted;
 * earlier and unattributed blocks are re-indexed from 1 within their block so
 * turn numbers never imply a single flat exchange across opportunities.
 */
export function renderAttributedPriorDialogue(
  dialogue: AttributedPriorDialogue,
  formatTurn: (turn: NegotiationTurn, index: number) => string,
): string {
  const blocks: string[] = [];

  for (const group of dialogue.earlier) {
    if (group.turns.length === 0) continue;
    blocks.push(`${earlierHeader(group)}\n${group.turns.map((t, i) => formatTurn(t, i)).join("\n")}`);
  }

  if (dialogue.unattributed.length > 0) {
    blocks.push(`[Earlier context — unattributed]\n${dialogue.unattributed.map((t, i) => formatTurn(t, i)).join("\n")}`);
  }

  if (dialogue.current.length > 0) {
    blocks.push(`[Current opportunity — under negotiation now]\n${dialogue.current.map((t, i) => formatTurn(t, i)).join("\n")}`);
  }

  return blocks.join("\n\n");
}
