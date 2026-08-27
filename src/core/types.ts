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

export interface NegotiationDecision<A extends string = string> {
  action: A;
  message: string;
}
