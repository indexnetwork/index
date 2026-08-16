/**
 * networks/domain — pure community contracts.
 *
 * Value types and graph-state shapes that define the communities capability's
 * domain language.  No LLM calls, no LangGraph edges, no cross-capability
 * imports beyond domain-level @langchain/langgraph annotations.
 *
 * ## What lives here
 *
 * - **NetworkGraphState** — input/output envelope for network lifecycle CRUD
 *   (create, read, update, delete).  Scope semantics (showAll, networkId filter)
 *   are part of this state.
 * - **NetworkMembershipGraphState** — input/output envelope for membership CRUD
 *   (add member, list members, remove member).  Membership authority policy
 *   (join-policy enforcement, owner-only removals) is implemented in the
 *   application layer but expressed through this state's inputs.
 *
 * ## What does NOT live here
 *
 * - IntentNetworkGraphState: it carries `IntentIndexerOutput` (a signals type)
 *   and `DebugMetaAgent` (a participant-agents type), so it belongs in the
 *   application layer (networks/application/indexer.state.ts).
 *
 * IND-546: canonical home for pure community state types.
 * Legacy paths (network/network.state.ts, network/membership/membership.state.ts)
 * are thin compatibility re-exports pointing here.
 */

// ── Network lifecycle state ───────────────────────────────────────────────────
export { NetworkGraphState } from "./network.state.js";

// ── Membership state ──────────────────────────────────────────────────────────
export { NetworkMembershipGraphState } from "./membership.state.js";
