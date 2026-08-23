import { StateGraph, START, END } from "@langchain/langgraph";
import { EnrichmentGraphState } from "./enrichment.state.js";
import { EnrichmentGraphDatabase } from "../../platform/database.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";

const logger = protocolLogger("EnrichmentGraphFactory");

/**
 * Factory class to build and compile the Profile Query Graph.
 *
 * Query-only: reports whether the user has an enriched profile (ACTIVE
 * premises exist) and returns the users-sourced identity fields. Callers
 * that need this to gate other work (e.g. intent inference) invoke it with
 * `operationMode: 'query'`.
 */

/** The graph's channel state, as every node sees it. */
export type EnrichmentState = typeof EnrichmentGraphState.State;

/** Everything the enrichment nodes reach for. */
export interface EnrichmentGraphDeps {
  database: EnrichmentGraphDatabase;
}

export class EnrichmentGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: EnrichmentGraphDeps;

  constructor(database: EnrichmentGraphDatabase) {
    this.deps = { database };
  }

  public createGraph() {
    const deps = this.deps;

    const workflow = new StateGraph(EnrichmentGraphState)
      .addNode("check_state", (state: EnrichmentState) => checkStateNode(state, deps))
      .addEdge(START, "check_state")
      .addEdge("check_state", END);

    logger.verbose("Graph built successfully");
    return workflow.compile();
  }
}

// ─────────────────────────────────────────────────────────
// NODE: Check State
// Reports whether the user has been enriched (ACTIVE premises exist) and
// returns their users-sourced identity fields.
// ─────────────────────────────────────────────────────────
export async function checkStateNode(state: EnrichmentState, deps: EnrichmentGraphDeps) {
  return timed("ProfileGraph.checkState", async () => {
    if (!state.userId) {
      logger.error("Missing userId");
      return {
        error: "userId is required"
      };
    }

    logger.verbose("Checking profile state...", { userId: state.userId });

    try {
      const profile = await deps.database.getProfile(state.userId) as any;
      // "Has a profile" means the user has been enriched into ACTIVE premises
      // (the user_profiles replacement). `getProfile` returns a users-sourced row
      // for every existing user, so its presence doesn't signal enrichment --
      // the premise graph is the source of truth for whether generation has run.
      const hasBeenEnriched = (await deps.database.getPremisesForUser(state.userId, 'ACTIVE')).length > 0;

      logger.verbose("🚀 Query mode - returning existing profile (fast path)", {
        hasProfile: hasBeenEnriched
      });
      const profileWithId = hasBeenEnriched ? await deps.database.getProfileByUserId(state.userId) : null;
      return {
        profile: hasBeenEnriched ? (profile || undefined) : undefined,
        readResult: hasBeenEnriched
          ? {
              hasProfile: true,
              // Thin identity only. The structured skills/interests attributes are
              // retired (user_profiles removal, WS6); the rich identity text now
              // comes from the global user_context, injected by read_user_contexts.
              profile: {
                id: profileWithId?.id,
                name: profile?.identity?.name,
                bio: profile?.identity?.bio,
                location: profile?.identity?.location,
              },
            }
          : {
              hasProfile: false,
              message:
                "You don't have a profile yet. Would you like to create one? You can share your LinkedIn, GitHub, or X/Twitter profile, or just tell me about yourself.",
            },
      };
    } catch (error) {
      logger.error("Failed to load profile", {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        profile: undefined,
        error: `Failed to load profile from database: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  });
}
