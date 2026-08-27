export interface NegotiationParty {
  name: string;
  objective: string;
}

export type MessageRole = "incoming" | "outgoing";

export interface NegotiationMessage {
  role: MessageRole;
  content: string;
}

export interface NegotiationState {
  party: NegotiationParty;
  history: NegotiationMessage[];
}

export type NegotiationAction =
  | "propose"
  | "accept"
  | "reject"
  | "counter"
  | "question"
  | "outreach"
  | "withdraw"
  | "decline";

export interface NegotiationDecision {
  action: NegotiationAction;
  message: string;
}
