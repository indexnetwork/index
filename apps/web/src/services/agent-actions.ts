import { apiClient } from "@/lib/api";
import type { AgentActionConfirmationResponse, AgentActionProposalResolutionResponse } from "@/components/chat/AgentActionProposalCard";

/** Resolve one reporter proposal against canonical conversation- and owner-scoped server state. */
export function getAgentActionProposal(
  proposalId: string,
  conversationId: string,
): Promise<AgentActionProposalResolutionResponse> {
  const query = new URLSearchParams({ conversationId });
  return apiClient.get<AgentActionProposalResolutionResponse>(
    `/agent/actions/proposals/${encodeURIComponent(proposalId)}?${query.toString()}`,
  );
}

/** Confirm one reporter action proposal through the session-only API. */
export function confirmAgentActionProposal(
  proposalId: string,
  conversationId: string,
): Promise<AgentActionConfirmationResponse> {
  return apiClient.post<AgentActionConfirmationResponse>("/agent/actions/confirm", { proposalId, conversationId });
}
