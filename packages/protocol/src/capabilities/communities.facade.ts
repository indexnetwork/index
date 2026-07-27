/**
 * Communities capability's supported graph and tool entry points.
 *
 * IND-546: canonical implementations live in src/communities/; the old
 * network/, network/membership/, and network/indexer/ paths remain as
 * compatibility re-exports.  This facade now imports from the communities
 * domain-first module.
 */
export { NetworkGraphFactory } from "../communities/application/index.js";
export { NetworkMembershipGraphFactory } from "../communities/application/index.js";
export { IntentNetworkGraphFactory } from "../communities/application/index.js";
export { createNetworkTools } from "../communities/application/index.js";
export type { NetworkToolDeps } from "./communities.tools.port.js";
