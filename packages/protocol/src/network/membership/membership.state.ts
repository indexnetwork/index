import { Annotation } from "@langchain/langgraph";

/**
 * Network Membership Graph State.
 * Handles CRUD operations for network memberships (index_members table).
 *
 * Flow:
 * START → routerNode → {addMemberNode | listMembersNode | removeMemberNode} → END
 */
export const NetworkMembershipGraphState = Annotation.Root({
  // --- Core Inputs (from ChatGraph via ToolContext) ---

  /** User performing the action (the actor). Always required. */
  userId: Annotation<string>,

  /** Target index. Required for all operations. */
  networkId: Annotation<string>,

  /** Operation mode. */
  operationMode: Annotation<'create' | 'read' | 'delete'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'read' as const,
  }),

  // --- Mode-Specific Inputs ---

  /** For create/delete: the user being added/removed. */
  targetUserId: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  // --- Outputs ---

  /** Output for read mode: list of members. */
  readResult: Annotation<{
    networkId: string;
    count: number;
    members: Array<{
      userId: string;
      name: string;
      avatar: string | null;
      permissions: string[];
      intentCount: number;
      joinedAt: Date;
    }>;
  } | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Output for create/delete modes. */
  mutationResult: Annotation<{
    success: boolean;
    message?: string;
    error?: string;
  } | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Error message if graph could not complete. */
  error: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});
