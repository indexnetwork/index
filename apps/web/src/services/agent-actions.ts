import { apiClient } from "@/lib/api";
import type { AgentActionConfirmationResponse } from "@/components/chat/AgentActionProposalCard";

/** Confirm one reporter action proposal through the session-only API. */
export function confirmAgentActionProposal(proposalId: string): Promise<AgentActionConfirmationResponse> {
  return apiClient.post<AgentActionConfirmationResponse>("/agent/actions/confirm", { proposalId });
}
