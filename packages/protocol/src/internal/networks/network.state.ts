/**
 * Network Graph State.
 * Handles CRUD operations for networks (communities).
 *
 * Lifecycle flow:
 * route by mode → {createNode | readNode | updateNode | deleteNode}
 *
 * ## Scope semantics
 *
 * When the chat is network-scoped (`networkId` is set) and `showAll` is false,
 * readNode surfaces only the focused network.
 * Setting `showAll: true` bypasses the restriction (admin use).
 */

export interface NetworkCreateInput {
  title: string;
  prompt?: string;
  imageUrl?: string | null;
  joinPolicy?: 'anyone' | 'invite_only';
}

export interface NetworkUpdateInput {
  title?: string;
  prompt?: string | null;
  imageUrl?: string | null;
  joinPolicy?: 'anyone' | 'invite_only';
}

export interface NetworkReadResult {
  memberOf: Array<{
    networkId: string;
    title: string;
    prompt: string | null;
    autoAssign: boolean;
    joinedAt: Date;
  }>;
  owns: Array<{
    networkId: string;
    title: string;
    prompt: string | null;
    memberCount: number;
    intentCount: number;
    joinPolicy: string;
  }>;
  publicNetworks?: Array<{
    networkId: string;
    title: string;
    prompt: string | null;
    memberCount: number;
    owner: { name: string; avatar: string | null } | null;
  }>;
  stats: {
    memberOfCount: number;
    ownsCount: number;
    publicNetworksCount?: number;
    scopeNote?: string;
  };
}

export interface NetworkMutationResult {
  success: boolean;
  networkId?: string;
  title?: string;
  message?: string;
  error?: string;
}

export interface NetworkState {
  // --- Core Inputs (from ChatGraph via ToolContext) ---

  /** User performing the action. Always required. */
  userId: string;

  /** Target network ID. Required for read/update/delete. From ChatGraph or tool arg. */
  networkId: string | undefined;

  /** Operation mode. */
  operationMode: 'create' | 'read' | 'update' | 'delete';

  // --- Mode-Specific Inputs ---

  /** For create mode: network creation data. */
  createInput: NetworkCreateInput | undefined;

  /** For update mode: fields to update. */
  updateInput: NetworkUpdateInput | undefined;

  /**
   * When true and network-scoped, read returns all user networks (not just scoped one).
   * Default false to enforce strict scope isolation.
   */
  showAll: boolean;

  // --- Outputs ---

  /** Output for read mode. */
  readResult: NetworkReadResult | undefined;

  /** Output for create/update/delete modes. */
  mutationResult: NetworkMutationResult | undefined;

  /** Error message if graph could not complete. */
  error: string | null;
}

/** What every field holds before a caller's input is applied. */
export function networkDefaults(): NetworkState {
  return {
    userId: "",
    networkId: undefined,
    operationMode: 'read',
    createInput: undefined,
    updateInput: undefined,
    showAll: false,
    readResult: undefined,
    mutationResult: undefined,
    error: null,
  };
}

/** What a caller supplies; everything else comes from the defaults. */
export type NetworkInput =
  Pick<NetworkState, "userId">
  & Partial<Omit<NetworkState, "userId" | "readResult" | "mutationResult" | "error">>;
