import type { Id } from './common.types';

/** Role of a participant in a negotiation */
export type NegotiationParticipantRole = 'initiator' | 'responder';

/** Participant in a negotiation */
export interface NegotiationParticipant {
  userId: Id<'users'>;
  role: NegotiationParticipantRole;
  name?: string;
}

/** Source that triggered the negotiation */
export type NegotiationTriggerSource = 'search' | 'subscription';

/** Trigger context for how the negotiation was initiated */
export interface NegotiationTrigger {
  source: NegotiationTriggerSource;
  intentId?: Id<'intents'>;
  query?: string;
  indexId?: Id<'indexes'>;
}

/** Structure of a negotiation turn message */
export interface NegotiationMessage {
  context: string;
  upside?: string;
  invitation?: string;
}

/** A single turn in the negotiation */
export interface NegotiationTurn {
  turn: number;
  participantUserId: Id<'users'>;
  participantName?: string;
  message: NegotiationMessage;
  decision: NegotiationDecision;
  reasoning: string;
  extendReason?: string;
  timestamp: string;
}

/** Possible decisions an agent can make during negotiation */
export type NegotiationDecision = 'continue' | 'extend' | 'accept' | 'decline' | 'defer';

/** Outcome of a completed negotiation */
export type NegotiationOutcome = 'opportunity' | 'disengaged' | 'deferred';

/** Resolution details when negotiation completes */
export interface NegotiationResolution {
  reasoning: string;
  outcome: NegotiationOutcome;
  opportunityId?: Id<'opportunities'>;
}

/** Status of a negotiation */
export type NegotiationStatus = 'initiated' | 'in_progress' | 'resolved' | 'expired';

/** Input for the negotiation agent */
export interface NegotiationAgentInput {
  principal: {
    userId: Id<'users'>;
    profile: {
      name?: string;
      bio?: string;
      location?: string;
      interests?: string[];
      skills?: string[];
      context?: string;
    };
    activeIntents: Array<{
      intentId: Id<'intents'>;
      payload: string;
      summary?: string;
    }>;
  };
  counterparty: {
    userId: Id<'users'>;
    profile: {
      name?: string;
      bio?: string;
      location?: string;
      interests?: string[];
      skills?: string[];
      context?: string;
    };
    activeIntents: Array<{
      intentId: Id<'intents'>;
      payload: string;
      summary?: string;
    }>;
  };
  negotiationState: {
    turns: NegotiationTurn[];
    currentTurn: number;
    trigger: NegotiationTrigger;
  };
  action: 'generate_turn' | 'evaluate_response';
}

/** Output from the negotiation agent */
export interface NegotiationAgentOutput {
  message?: NegotiationMessage;
  decision: NegotiationDecision;
  reasoning: string;
  extendReason?: string;
}
