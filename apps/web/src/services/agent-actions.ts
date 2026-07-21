import { apiClient } from "@/lib/api";
import type { AgentActionConfirmationResponse, AgentActionProposalResolutionResponse } from "@/components/chat/AgentActionProposalCard";

/** Resolve one reporter proposal against canonical owner-scoped server state. */
export function getAgentActionProposal(proposalId: string): Promise<AgentActionProposalResolutionResponse> {
  return apiClient.get<AgentActionProposalResolutionResponse>(`/agent/actions/proposals/${proposalId}`);
}

/** Confirm one reporter action proposal through the session-only API. */
export function confirmAgentActionProposal(proposalId: string): Promise<AgentActionConfirmationResponse> {
  return apiClient.post<AgentActionConfirmationResponse>("/agent/actions/confirm", { proposalId });
}
