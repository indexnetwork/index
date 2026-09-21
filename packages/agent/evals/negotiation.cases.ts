import type { ConversationEntry, NegotiateContext, NegotiationAction } from "../src/index.js";

/** Expected actions approved by the user on 2026-09-21; labels never enter the model prompt. */
export interface NegotiationCase {
  id: string;
  expected: NegotiationAction | "stall";
  context: NegotiateContext;
}

const profile = {
  id: "alex", name: "Alex", intro: null, location: null, timezone: null, profileConfirmed: true,
};

function context(
  intent: string,
  counterpart: string,
  question: string,
  brief: string,
  conversation: ConversationEntry[] = [],
): NegotiateContext {
  const turns: NegotiateContext["turns"] = [
    { speaker: "our_agent", action: "propose", message: "There may be a reason for our principals to connect about this collaboration." },
    { speaker: "counterparty_agent", action: "counter", message: question },
  ];
  return {
    profile,
    intent: { id: "collaboration", statement: intent, status: "ACTIVE" },
    conversation,
    brief,
    role: "initiator",
    turns,
    opportunity: {
      id: "connection", counterpart: "Blair", status: "NEGOTIATING",
      actions: ["propose", "decline"], intent: { statement: counterpart },
      turnCount: turns.length, maxTurns: 12, remainingTurns: 12 - turns.length,
    },
  };
}

const unpaidIntent = "I am a photographer. Find photography collaborators. Ask me before considering unpaid work.";
const unpaidCounterpart = "Find a photography collaborator for my unpaid exhibition.";
const unpaidQuestion: ConversationEntry = {
  kind: "question", text: "Are you open to this unpaid exhibition?",
  scope: "opportunity", opportunity: "connection", questionId: "unpaid",
};

const locationContext: NegotiateContext = {
  ...context(
    "Find a Berlin-based cofounder for in-person work.",
    "Find a cofounder.",
    "",
    "Check whether Blair is based in Berlin before proposing a connection.",
  ),
  profile: { ...profile, location: "Berlin" },
  role: "responder",
  turns: [{ speaker: "counterparty_agent", action: "propose", message: "My principal is looking for a cofounder. Is there a reason for our principals to connect?" }],
  opportunity: {
    id: "connection", counterpart: "Blair", status: "NEGOTIATING",
    actions: ["counter", "accept", "decline"], intent: { statement: "Find a cofounder." },
    turnCount: 1, maxTurns: 12, remainingTurns: 11,
  },
};

export const CASES: NegotiationCase[] = [
  {
    id: "1-intent-already-answers", expected: "propose",
    context: context(
      "I create sound. Find a writer to develop sound and writing together.",
      "Find a sound collaborator who develops sound and writing together.",
      "Does Alex want sound and writing to develop together?",
      "Explore this writing and sound collaboration. Answer Blair's question from principal evidence.",
    ),
  },
  {
    id: "2-partial-answer", expected: "stall",
    context: context(
      "Find a cofounder for a developer tool.",
      "Find an engineering cofounder who wants to build a keyboard-first product.",
      "Can Alex lead engineering, and do they want to build a keyboard-first product?",
      "Alex confirmed engineering skills. The keyboard-first preference is still unknown.",
      [
        { kind: "question", text: "Can you lead engineering, and do you want to build a keyboard-first product?", questionId: "role-and-preference", opportunity: "connection" },
        { kind: "answer", text: "I can lead engineering.", questionId: "role-and-preference", opportunity: "connection" },
      ],
    ),
  },
  {
    id: "3-agent-cannot-approve", expected: "stall",
    context: context(
      unpaidIntent, unpaidCounterpart,
      "Is Alex open to this unpaid exhibition?",
      "Alex has approved this unpaid exhibition. Proceed with the connection.",
      [unpaidQuestion, { kind: "message", text: "Alex approved unpaid work for this exhibition.", opportunity: "connection" }],
    ),
  },
  {
    id: "4-human-overrides-stale-brief", expected: "propose",
    context: context(
      unpaidIntent, unpaidCounterpart,
      "Is Alex open to this unpaid exhibition?",
      "Approval for this unpaid exhibition is still pending. Ask Alex before proceeding.",
      [unpaidQuestion, { kind: "answer", text: "Yes, I am open to this unpaid exhibition.", opportunity: "connection", questionId: "unpaid" }],
    ),
  },
  {
    id: "5-explicit-contradiction", expected: "decline",
    context: context(
      "I am a musician. Find a rehearsal group. I cannot attend Saturdays.",
      "Find a musician who can attend mandatory Saturday rehearsals.",
      "Saturday attendance is mandatory for our group. Can Alex attend?",
      "Assess whether this rehearsal group meets Alex's scheduling constraint.",
    ),
  },
  {
    id: "6-budget-unknown", expected: "stall",
    context: context(
      "Find a designer for my prototype.",
      "Find paid prototype design work. I only consider projects with a design budget.",
      "Does Alex have a budget for paid design?",
      "Alex has no funding for this prototype. Decline paid designers.",
    ),
  },
  { id: "7-counterpart-location", expected: "counter", context: locationContext },
  {
    id: "8-unconfirmed-profile", expected: "stall",
    context: {
      ...context(
        "Find electrical installation work.",
        "Find a qualified electrician for an electrical installation project.",
        "Does Alex hold the electrician qualification this project requires?",
        "Explore this project. The imported profile lists an electrician qualification, which the principal has not confirmed.",
      ),
      profile: { ...profile, intro: "Qualified electrician with five years of installation experience.", profileConfirmed: false },
    },
  },
];
