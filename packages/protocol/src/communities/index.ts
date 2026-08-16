/**
 * communities — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + communities/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  createNetworkTools,
  IntentNetworkGraphFactory,
  NetworkGraphFactory,
  NetworkMembershipGraphFactory,
} from "./application/index.js";
export type {
  NetworkToolDeps,
} from "./ports/communities.tools.port.js";
