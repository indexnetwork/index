import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

/** Zod schema for a single negotiation turn (DataPart payload in A2A message). */
export const NegotiationTurnSchema = z.object({
  action: z.enum(["propose", "accept", "reject", "counter"]),
  assessment: z.object({
    fitScore: z.number().min(0).max(100),
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
});

export type NegotiationTurn = z.infer<typeof NegotiationTurnSchema>;

/** Zod schema for the negotiation outcome (Artifact payload on COMPLETED task). */
export const NegotiationOutcomeSchema = z.object({
  hasOpportunity: z.boolean(),
  finalScore: z.number().min(0).max(100),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: z.enum(["agent", "patient", "peer"]),
  })),
  reasoning: z.string(),
  turnCount: z.number(),
  reason: z.string().optional(),
});

export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

/** Context each agent receives about its user. */
export interface UserNegotiationContext {
  id: string;
  intents: Array<{ id: string; title: string; description: string; confidence: number }>;
  profile: { name?: string; bio?: string; location?: string; interests?: string[]; skills?: string[] };
}

/** Seed assessment from the evaluator pre-filter. */
export interface SeedAssessment {
  score: number;
  reasoning: string;
  valencyRole: string;
  actors?: Array<{ userId: string; role: string }>;
}

/** Typed interface for a negotiation graph's invoke signature. */
export interface NegotiationGraphLike {
  invoke(input: {
    sourceUser: UserNegotiationContext;
    candidateUser: UserNegotiationContext;
    indexContext: { indexId: string; prompt: string };
    seedAssessment: Omit<SeedAssessment, "actors">;
    maxTurns?: number;
  }): Promise<{ outcome: NegotiationOutcome | null; messages?: NegotiationMessage[] }>;
}

/** A2A message record shape (matches messages table). */
export interface NegotiationMessage {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
}

/** LangGraph state annotation for the negotiation graph. */
export const NegotiationGraphState = Annotation.Root({
  sourceUser: Annotation<UserNegotiationContext>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ id: "", intents: [], profile: {} }),
  }),
  candidateUser: Annotation<UserNegotiationContext>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ id: "", intents: [], profile: {} }),
  }),
  indexContext: Annotation<{ indexId: string; prompt: string }>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ indexId: "", prompt: "" }),
  }),
  seedAssessment: Annotation<SeedAssessment>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ score: 0, reasoning: "", valencyRole: "" }),
  }),

  conversationId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  taskId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  messages: Annotation<NegotiationMessage[]>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),
  turnCount: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),
  maxTurns: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 6,
  }),

  currentSpeaker: Annotation<"source" | "candidate">({
    reducer: (curr, next) => next ?? curr,
    default: () => "source" as const,
  }),
  lastTurn: Annotation<NegotiationTurn | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  outcome: Annotation<NegotiationOutcome | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
});
