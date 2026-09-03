/**
 * Merging for graphs that route explicitly rather than through LangGraph.
 *
 * A compiled StateGraph applied a per-channel reducer when a node returned a
 * patch. Most channels were last-write-wins, which a plain object spread
 * reproduces exactly — but a few accumulate across nodes, and for those a
 * spread silently keeps only the final node's contribution. That loss is
 * invisible to `tsc` (the types are identical) and to any assertion that only
 * checks the last node's output, so the channels are named here once rather
 * than re-derived at each call site.
 */

/**
 * Channels a node contributes to rather than overwrites.
 *
 * - `trace` — one entry per node; the whole point is the sequence.
 * - `agentTimings` — per-model-call timings, collected for debug metadata.
 */
const ACCUMULATING_CHANNELS = ["trace", "agentTimings"] as const;

/**
 * Applies a node's patch to graph state.
 *
 * @param state - State as it stood before the node ran.
 * @param patch - What the node returned. A node that returns nothing changes
 *   nothing, matching a LangGraph node that returned `{}`.
 * @returns The merged state: accumulating channels concatenated, everything
 *   else replaced by the patch where it supplied a value.
 */
export function mergeGraphState<S extends Record<string, unknown>>(
  state: S,
  patch: Partial<S> | undefined | null | void,
): S {
  if (!patch) return state;
  const merged = { ...state, ...patch } as S;
  for (const channel of ACCUMULATING_CHANNELS) {
    const before = state[channel];
    const added = (patch as Record<string, unknown>)[channel];
    // Only when the node actually contributed: an absent channel already
    // kept its previous value through the spread above.
    if (Array.isArray(before) && Array.isArray(added)) {
      (merged as Record<string, unknown>)[channel] = [...before, ...added];
    }
  }
  return merged;
}
