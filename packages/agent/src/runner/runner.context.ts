import type { NegotiateContext } from "../agents/negotiator.agent.js";
import type { BriefContext, WakeContext } from "../agents/principal/principal.context.js";
import type { Decision, Intent, NegotiationAction } from "../agents/shared/agent.context.js";

import type { AgentHost, NegotiationDetail } from "./agent.host.js";
import { createPublicationContext, readConversation, readStandingContext, toOpportunity, type PublicationContext } from "./conversation.codec.js";

const PERMITTED: Record<Decision, NegotiationAction[]> = {
  continue: ["propose", "counter", "accept", "decline"],
  accept: ["accept", "propose"],
  decline: ["decline"],
  stop: [],
};

export interface IntentMembership {
  active: Set<string>;
}

export async function readWakeContext(host: AgentHost, abortSignal: AbortSignal, membershipState: IntentMembership, intentId: string): Promise<{
  wake: WakeContext;
  publication: PublicationContext;
} | undefined> {
  let membership = membershipState.active;
  const [context, negotiations] = await Promise.all([readIntentContext(host, intentId), host.listNegotiations()]);
  abortSignal.throwIfAborted();
  while (membership !== membershipState.active) {
    membership = membershipState.active;
    context.intent = await host.getIntent(intentId);
    abortSignal.throwIfAborted();
  }
  const active = context.intent.status === "ACTIVE";
  const updated = new Set(membership);
  if (active) updated.add(context.intent.id);
  else updated.delete(context.intent.id);
  membershipState.active = updated;
  if (!active) return undefined;

  const details = await Promise.all(negotiations.filter(({ intentId: id }) => id === context.intent.id).map(({ opportunityId }) => host.getNegotiation(opportunityId)));
  const current = details.filter(({ intentId: id }) => id === context.intent.id);
  const standing = readStandingContext(context.conversation);
  return {
    wake: {
      ...context,
      opportunities: current.map((negotiation) => ({ ...toOpportunity(negotiation, context.profile.id), ...standing.get(negotiation.opportunityId) })),
    },
    publication: createPublicationContext(context.conversation, current),
  };
}

export async function readNegotiationContext(host: AgentHost, intentId: string, opportunityId: string): Promise<{
  briefing: BriefContext;
  negotiation: NegotiationDetail;
  publication: PublicationContext;
} | undefined> {
  const [context, negotiation] = await Promise.all([readIntentContext(host, intentId), host.getNegotiation(opportunityId)]);
  if (
    context.intent.status !== "ACTIVE" || negotiation.intentId !== context.intent.id || negotiation.outcome !== null ||
    negotiation.settledAt !== null || negotiation.awaitingUserId !== context.profile.id ||
    negotiation.protocol.blockedReason !== null || !negotiation.protocol.availableActions.length
  ) return undefined;

  const standing = readStandingContext(context.conversation);
  return {
    briefing: { ...context, opportunity: { ...toOpportunity(negotiation, context.profile.id), ...standing.get(negotiation.opportunityId) } },
    negotiation,
    publication: createPublicationContext(context.conversation, [negotiation]),
  };
}

export function prepareNegotiationContext(briefing: BriefContext, negotiation: NegotiationDetail): NegotiateContext | undefined {
  const { profile, intent, opportunity } = briefing;
  const { brief, decision } = opportunity;
  if (!brief || !decision) return undefined;
  const initiatorId = negotiation.turns[0]?.seatUserId ?? negotiation.awaitingUserId;
  const role = initiatorId === profile.id ? "initiator" : "responder";
  const actions = negotiation.protocol.availableActions.filter((action) => PERMITTED[decision].includes(action) && (action !== "accept" || role === "responder"));
  if (!actions.length) return undefined;
  return { profile, intent, brief, role, opportunity: { ...opportunity, actions } };
}

async function readIntentContext(host: AgentHost, intentId: string): Promise<Pick<WakeContext, "profile" | "intent" | "conversation">> {
  const [profile, intent, inbox] = await Promise.all([host.getProfile(), host.getIntent(intentId), host.getConversation(intentId)]);
  return { profile, intent: intent as Intent, conversation: readConversation(inbox.messages) };
}
