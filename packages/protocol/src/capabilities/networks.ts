/**
 * networks — the capability's single public surface.
 *
 * Everything the rest of the package (and every host) may reach lives on the
 * {@link Networks} class. The files beside this one are private implementation,
 * named for what they do rather than for the layer they sit in:
 *
 *   network.graph        the community lifecycle graph — create, read, update, delete
 *   network.state        that graph's channel state
 *   membership.graph     the roster graph — add, list, remove members
 *   membership.state     that graph's channel state
 *   indexer.graph        signal↔community assignment, direct or model-evaluated
 *   indexer.state        that graph's channel state
 *   network.recommender  ranking public communities during onboarding
 *   network.tools        the agent-facing tool definitions
 *
 * No directories: every stage here is one or two files, so a folder per stage
 * would only add a hop. Nothing outside `networks/` imports any of it; the
 * layout may change freely as long as this class keeps its shape.
 */

import type { DefineTool } from "../internal/shared/agent/tool.helpers.js";
import type { IntentNetworkGraphDatabase, NetworkGraphDatabase, NetworkMembershipGraphDatabase } from "../platform/database.js";

import { IntentNetworkGraphFactory } from "../internal/networks/indexer.graph.js";
import { NetworkMembershipGraphFactory } from "../internal/networks/membership.graph.js";
import { NetworkGraphFactory } from "../internal/networks/network.graph.js";
import { createNetworkTools } from "../internal/networks/network.tools.js";

import type { IntentNetworkIndexer } from "../protocol/core.js";
import type { NetworkToolDeps } from "../internal/networks/network.tools.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type { IntentNetworkIndexer, NetworkToolDeps };

/**
 * Host capabilities the community graphs need.
 *
 * Both fields are optional so a host can construct `new Networks()` and reach
 * only {@link Networks.createTools}; each `create…Graph` method names the
 * dependency it requires.
 */
export interface NetworksDeps {
  /**
   * Community, roster, and assignment persistence. Required by every
   * `create…Graph` method — hosts pass one adapter satisfying all three
   * query sets.
   */
  database?: NetworkGraphDatabase & NetworkMembershipGraphDatabase & IntentNetworkGraphDatabase;
  /**
   * Scores a signal against a community. Required by
   * {@link Networks.createAssignmentGraph}; an `Intents` instance satisfies it.
   */
  indexer?: IntentNetworkIndexer;
}

/**
 * The networks capability.
 *
 * One instance is cheap: it holds its dependencies and compiles a graph only
 * when asked, so a host can keep a single `Networks` and build just the graphs
 * it serves.
 */
export class Networks {
  private readonly deps: NetworksDeps;

  constructor(deps: NetworksDeps = {}) {
    this.deps = deps;
  }

  // ── Community lifecycle ─────────────────────────────────────────────────────

  /**
   * Build the community lifecycle graph — create, read, update, delete.
   *
   * @throws If the instance was constructed without a `database`.
   */
  public createGraph() {
    return new NetworkGraphFactory(this.database("createGraph")).createGraph();
  }

  // ── Roster ──────────────────────────────────────────────────────────────────

  /**
   * Build the membership graph — add, list, and remove members, under the
   * community's join policy and owner authority.
   *
   * @throws If the instance was constructed without a `database`.
   */
  public createMembershipGraph() {
    return new NetworkMembershipGraphFactory(this.database("createMembershipGraph")).createGraph();
  }

  // ── Signal assignment ───────────────────────────────────────────────────────

  /**
   * Build the signal↔community assignment graph — link a signal to a community
   * directly or after model evaluation, and unlink it.
   *
   * @throws If the instance was constructed without a `database` or an `indexer`.
   */
  public createAssignmentGraph() {
    const { indexer } = this.deps;
    if (!indexer) {
      throw new Error("Networks.createAssignmentGraph() requires an `indexer` dependency.");
    }
    return new IntentNetworkGraphFactory(this.database("createAssignmentGraph"), indexer).createGraph();
  }

  // ── Stateless surface ───────────────────────────────────────────────────────

  /** Register the agent-facing community tools against a tool definer. */
  public static createTools(defineTool: DefineTool, deps: NetworkToolDeps) {
    return createNetworkTools(defineTool, deps);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  /** The database, or the error naming the method that needed it. */
  private database(method: string) {
    const { database } = this.deps;
    if (!database) {
      throw new Error(`Networks.${method}() requires a \`database\` dependency.`);
    }
    return database;
  }
}
