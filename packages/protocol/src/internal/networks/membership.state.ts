/**
 * Network Membership Graph State.
 * Handles CRUD operations for network memberships (index_members table).
 *
 * ## Membership authority policy
 *
 * - `create` / self-join: allowed only when `joinPolicy: 'anyone'`.
 * - `create` / invite (targetUserId ≠ userId): caller must be a member;
 *   for `invite_only` networks, caller must also be the owner.
 * - `delete`: owner-only; the owner themselves cannot be removed via this path
 *   (delete the network instead).
 * - `read`: caller must be a member of the network to list its members.
 *
 * Flow:
 * route by mode → {addMemberNode | listMembersNode | removeMemberNode}
 */

/** One member row as `read` mode returns it. */
export interface NetworkMemberSummary {
  userId: string;
  name: string;
  avatar: string | null;
  permissions: string[];
  intentCount: number;
  joinedAt: Date;
}

export interface NetworkMembershipState {
  // --- Core Inputs (from ChatGraph via ToolContext) ---

  /** User performing the action (the actor). Always required. */
  userId: string;

  /** Target network. Required for all operations. */
  networkId: string;

  /** Operation mode. */
  operationMode: 'create' | 'read' | 'delete';

  // --- Mode-Specific Inputs ---

  /** For create/delete: the user being added/removed. */
  targetUserId: string | undefined;

  // --- Outputs ---

  /** Output for read mode: list of members. */
  readResult: { networkId: string; count: number; members: NetworkMemberSummary[] } | undefined;

  /** Output for create/delete modes. */
  mutationResult: { success: boolean; message?: string; error?: string } | undefined;

  /** Error message if graph could not complete. */
  error: string | null;
}

/** What every field holds before a caller's input is applied. */
export function networkMembershipDefaults(): NetworkMembershipState {
  return {
    userId: "",
    networkId: "",
    operationMode: 'read',
    targetUserId: undefined,
    readResult: undefined,
    mutationResult: undefined,
    error: null,
  };
}

/** What a caller supplies; everything else comes from the defaults. */
export type NetworkMembershipInput =
  Pick<NetworkMembershipState, "userId" | "networkId">
  & Partial<Pick<NetworkMembershipState, "operationMode" | "targetUserId">>;
