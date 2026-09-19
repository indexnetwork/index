/** Explicit lifecycle causes of discovery; never inferred from startup or A2A activity. */
export type IntentActivation =
  | { id: string; type: 'intent.created' }
  | { id: string; type: 'intent.broadcast'; networkId: string }
  | { id: string; type: 'intent.revised'; revisionVersionMs: number; fingerprint: string }
  | { id: string; type: 'intent.resumed'; lifecycleVersionMs: number };

/** Explicit H2A review causes; a manual wake carries no new principal evidence. */
export type PrincipalActivation = IntentActivation | { id: string; type: 'h2a.wake' };

/** Observations of committed or locally completed agent transitions, never commands or wake sources. */
export type AgentDomainEvent =
  | { type: 'h2a.activated'; inputId: string; cause: 'user' | 'answer' | PrincipalActivation['type'] }
  | { type: 'discovery.searched'; inputId: string; matchId: string; networkIds: string[]; candidateIntentIds: string[] }
  | { type: 'negotiation.opened'; inputId: string; opportunityId: string; candidateIntentId: string; networkId: string }
  | { type: 'question.answered'; inputId: string; questionId: string; batchId: string }
  | { type: 'question.asked'; inputId: string; questionId: string; batchId: string }
  | { type: 'question.retired'; inputId: string; questionId: string; batchId: string }
  | { type: 'standing_brief.saved'; inputId: string; standingBriefId: string }
  | { type: 'delegation.brief_saved'; inputId: string; delegationId: string; opportunityId: string; source: 'opening' | 'review' }
  | { type: 'h2a.review_completed'; inputId: string; questionIds: string[]; delegatedIds: string[] }
  | { type: 'h2a.review_discarded'; inputId: string; reason: 'stale_context' }
  | { type: 'negotiation.inbound'; opportunityId: string }
  | { type: 'negotiation.turn_submitted'; opportunityId: string; turnIndex: number; action: 'propose' | 'counter' | 'accept' | 'decline' }
  | { type: 'negotiation.paused'; opportunityId: string; turnCount: number; delegationId?: string; reason: 'awaiting_principal_review' | 'missing_facts_or_authority' | 'protocol_blocked'; blockedReason?: string }
  | { type: 'negotiation.settled'; opportunityId: string; outcome: string | null; turnCount: number };
