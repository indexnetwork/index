import type { NegotiationAgentInput } from "../../application/negotiation.agent.js";

/**
 * Fixed input matrix for the negotiator system-prompt byte-identity guard
 * (IND-611).
 *
 * Every branch of the prompt builder that a stance fragment could plausibly
 * disturb is represented: both v2 seats, v1, the discovery-query block, the
 * `canAskUser` grant, the deadlock/bargaining shift, and the final turn. The
 * golden file captured from the pre-stance revision pins each rendering, so a
 * stance fragment that leaks under `advocate` fails loudly here rather than in
 * production prompts.
 *
 * Shared by `scripts/capture-negotiator-prompts.ts` (generation) and
 * `negotiation.stance.spec.ts` (assertion) so both render from one definition.
 */

const ownUser = {
  id: "u-init",
  intents: [{ id: "i-1", title: "Ship an eval harness", description: "Looking for an ML engineer", confidence: 1 }],
  profile: { name: "Alice", bio: "PM at an AI startup", skills: ["product", "evals"] },
};

const otherUser = {
  id: "u-cp",
  intents: [{ id: "i-2", title: "Join an AI product", description: "Wants applied ML work", confidence: 1 }],
  profile: { name: "Bob", bio: "ML engineer", skills: ["ml", "python"] },
};

const base: NegotiationAgentInput = {
  ownUser,
  otherUser,
  indexContext: { networkId: "net-1", prompt: "AI builders network" },
  seedAssessment: { reasoning: "complementary skills", valencyRole: "peer" },
  history: [
    { action: "outreach", assessment: { reasoning: "reaching out", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "hi" },
    { action: "question", assessment: { reasoning: "need a clarification", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "which stack?" },
  ],
  seat: "initiator",
  protocolVersion: "v2",
};

export interface PromptMatrixEntry {
  id: string;
  /** Scripted model action; must be legal for the entry's seat/turn. */
  action: string;
  input: NegotiationAgentInput;
}

export const PROMPT_MATRIX: PromptMatrixEntry[] = [
  { id: "v2-initiator", action: "counter", input: base },
  { id: "v2-initiator-final", action: "withdraw", input: { ...base, isFinalTurn: true } },
  { id: "v2-initiator-ask-user", action: "counter", input: { ...base, canAskUser: true } },
  {
    id: "v2-initiator-discovery-query",
    action: "counter",
    input: { ...base, isDiscoverer: true, discoveryQuery: "ML engineers" },
  },
  {
    id: "v2-initiator-opening",
    action: "outreach",
    input: { ...base, history: [] },
  },
  {
    id: "v2-initiator-bargaining",
    action: "counter",
    input: { ...base, bargaining: { consecutiveNonConvergent: 4 } },
  },
  {
    id: "v2-initiator-bargaining-ask-user",
    action: "counter",
    input: { ...base, canAskUser: true, bargaining: { consecutiveNonConvergent: 5 } },
  },
  { id: "v2-counterparty", action: "accept", input: { ...base, seat: "counterparty" } },
  {
    id: "v2-counterparty-discovery-query",
    action: "accept",
    input: { ...base, seat: "counterparty", isDiscoverer: true, discoveryQuery: "ML engineers" },
  },
  { id: "v1", action: "counter", input: { ...base, protocolVersion: "v1", seat: undefined } },
  {
    id: "v1-discovery-query",
    action: "counter",
    input: { ...base, protocolVersion: "v1", seat: undefined, isDiscoverer: true, discoveryQuery: "ML engineers" },
  },
];
