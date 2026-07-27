export type AgentCleanupActionType = "retract_premise" | "narrow_signal" | "pause_signal";

export interface AgentActionProposalSnapshot {
  status: string;
  updatedAt?: string;
  payload?: string;
  summary?: string | null;
  assertionText?: string;
}

interface AgentActionProposalActionBase {
  entityId: string;
  currentState: string;
  proposedOperation: string;
  evidence?: string;
  skipped?: boolean;
  reason?: string;
  snapshot?: AgentActionProposalSnapshot;
  description?: string;
}

export type AgentActionProposalAction =
  | (AgentActionProposalActionBase & { type: "retract_premise" })
  | (AgentActionProposalActionBase & { type: "narrow_signal" })
  | (AgentActionProposalActionBase & { type: "pause_signal" });

export interface AgentActionProposal {
  proposalId: string;
  userId: string;
  conversationId?: string;
  actions: AgentActionProposalAction[];
}

/** Host persistence bridge for proposals; the reporter tool never mutates domain rows. */
export interface AgentActionProposalStore {
  createProposal(proposal: AgentActionProposal): Promise<void>;
}
