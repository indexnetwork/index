/**
 * Synchronous negotiation runner for chat integration.
 * 
 * Executes negotiations inline (not via queue) and streams progress events
 * for real-time display in the chat trace UI.
 * 
 * @remarks
 * This runner persists negotiations directly to the database. It is the correct
 * persistence path for chat-triggered negotiations (via opportunity tools).
 * 
 * The NegotiationGraph and NegotiationQueue are separate code paths for async
 * processing and should NOT be used together with this runner. Each path handles
 * its own persistence to avoid duplicate records.
 */

import type { CandidateMatch } from "../states/opportunity.state";
import type { ChatGraphCompositeDatabase } from "../interfaces/database.interface";
import type {
  NegotiationTrigger,
  NegotiationTurn,
  NegotiationDecision,
  NegotiationOutcome,
  NegotiationAgentInput,
  NegotiationParticipant,
  NegotiationResolution,
} from "../../../types/negotiation.types";
import { NegotiationAgent } from "../agents/negotiation.agent";
import { protocolLogger } from "./protocol.logger";
import db from "../../drizzle/drizzle";
import * as schema from "../../../schemas/database.schema";

const logger = protocolLogger("NegotiationRunner");

/** Progress event emitted during negotiation for streaming to UI */
export interface NegotiationProgressEvent {
  type: 'negotiation_start' | 'negotiation_turn' | 'negotiation_end';
  negotiationId: string;
  candidateUserId: string;
  candidateName?: string;
  turn?: number;
  maxTurns?: number;
  speaker?: 'user_agent' | 'candidate_agent';
  message?: string;
  decision?: NegotiationDecision;
  outcome?: NegotiationOutcome;
  reasoning?: string;
}

/** Result of a single negotiation */
export interface NegotiationResult {
  candidateUserId: string;
  candidateName?: string;
  outcome: NegotiationOutcome;
  turns: NegotiationTurn[];
  reasoning: string;
  candidate: CandidateMatch;
}

/** Input for the negotiation runner */
export interface NegotiationRunnerInput {
  userId: string;
  candidates: CandidateMatch[];
  database: ChatGraphCompositeDatabase;
  trigger: NegotiationTrigger;
  streamProgress?: (event: NegotiationProgressEvent) => void;
  maxTurns?: number;
  concurrency?: number;
  timeoutMs?: number;
}

/**
 * Run negotiations with multiple candidates in parallel batches.
 * Streams progress events for real-time UI updates.
 */
export async function runNegotiations(
  input: NegotiationRunnerInput
): Promise<NegotiationResult[]> {
  const {
    userId,
    candidates,
    database,
    trigger,
    streamProgress,
    maxTurns = 3,
    concurrency = 3,
    timeoutMs = 30000,
  } = input;

  if (candidates.length === 0) {
    return [];
  }

  logger.verbose("runNegotiations: starting", {
    userId,
    candidateCount: candidates.length,
    maxTurns,
    concurrency,
  });

  const agent = new NegotiationAgent();
  const results: NegotiationResult[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((candidate) =>
        runSingleNegotiation({
          userId,
          candidate,
          database,
          trigger,
          agent,
          maxTurns,
          timeoutMs,
          streamProgress,
        })
      )
    );
    results.push(...batchResults);
  }

  logger.verbose("runNegotiations: complete", {
    userId,
    total: results.length,
    accepted: results.filter((r) => r.outcome === "opportunity").length,
    declined: results.filter((r) => r.outcome === "disengaged").length,
    deferred: results.filter((r) => r.outcome === "deferred").length,
  });

  return results;
}

interface SingleNegotiationInput {
  userId: string;
  candidate: CandidateMatch;
  database: ChatGraphCompositeDatabase;
  trigger: NegotiationTrigger;
  agent: NegotiationAgent;
  maxTurns: number;
  timeoutMs: number;
  streamProgress?: (event: NegotiationProgressEvent) => void;
}

async function runSingleNegotiation(
  input: SingleNegotiationInput
): Promise<NegotiationResult> {
  const {
    userId,
    candidate,
    database,
    trigger,
    agent,
    maxTurns,
    timeoutMs,
    streamProgress,
  } = input;

  const negotiationId = crypto.randomUUID();
  const candidateUserId = candidate.candidateUserId;

  // Fetch profiles and intents for both parties
  const [userProfile, candidateProfile, userIntents, candidateIntents] =
    await Promise.all([
      database.getProfile(userId),
      database.getProfile(candidateUserId),
      database.getActiveIntents(userId),
      database.getActiveIntents(candidateUserId),
    ]);

  const candidateName = candidateProfile?.identity?.name ?? undefined;

  // Emit start event
  streamProgress?.({
    type: "negotiation_start",
    negotiationId,
    candidateUserId,
    candidateName,
    maxTurns,
  });

  const turns: NegotiationTurn[] = [];
  let currentTurn = 0;
  let effectiveMaxTurns = maxTurns;
  let outcome: NegotiationOutcome = "disengaged";
  let finalReasoning = "";

  const startTime = Date.now();

  // Build agent input helpers
  const buildPrincipalInput = (
    principalUserId: string,
    profile: typeof userProfile,
    intents: typeof userIntents
  ): NegotiationAgentInput["principal"] => ({
    userId: principalUserId,
    profile: {
      name: profile?.identity?.name,
      bio: profile?.identity?.bio,
      location: profile?.identity?.location,
      interests: profile?.attributes?.interests,
      skills: profile?.attributes?.skills,
      context: profile?.narrative?.context,
    },
    activeIntents: intents.map((i) => ({
      intentId: i.id,
      payload: i.payload,
      summary: i.summary ?? undefined,
    })),
  });

  try {
    while (currentTurn < effectiveMaxTurns) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        logger.warn("runSingleNegotiation: timeout", {
          negotiationId,
          candidateUserId,
          turn: currentTurn,
        });
        finalReasoning = "Negotiation timed out";
        break;
      }

      // Alternate between user agent and candidate agent
      const isUserTurn = currentTurn % 2 === 0;
      const speaker = isUserTurn ? "user_agent" : "candidate_agent";

      const principal = isUserTurn
        ? buildPrincipalInput(userId, userProfile, userIntents)
        : buildPrincipalInput(candidateUserId, candidateProfile, candidateIntents);

      const counterparty = isUserTurn
        ? buildPrincipalInput(candidateUserId, candidateProfile, candidateIntents)
        : buildPrincipalInput(userId, userProfile, userIntents);

      const agentInput: NegotiationAgentInput = {
        principal,
        counterparty,
        negotiationState: {
          turns,
          currentTurn,
          trigger,
        },
        action: "generate_turn",
      };

      const result = await agent.invoke(agentInput);

      // Build turn record
      const turn: NegotiationTurn = {
        turn: currentTurn,
        participantUserId: isUserTurn ? userId : candidateUserId,
        participantName: isUserTurn ? userProfile?.identity?.name : candidateName,
        message: result.message ?? { context: "(no message)" },
        decision: result.decision,
        reasoning: result.reasoning,
        extendReason: result.extendReason,
        timestamp: new Date().toISOString(),
      };
      turns.push(turn);

      // Stream progress
      const messageText = result.message
        ? [result.message.context, result.message.upside, result.message.invitation]
            .filter(Boolean)
            .join(" ")
        : undefined;

      streamProgress?.({
        type: "negotiation_turn",
        negotiationId,
        candidateUserId,
        candidateName,
        turn: currentTurn + 1,
        maxTurns: effectiveMaxTurns,
        speaker,
        message: messageText,
        decision: result.decision,
        reasoning: result.reasoning,
      });

      // Handle decision
      if (result.decision === "accept") {
        outcome = "opportunity";
        finalReasoning = result.reasoning;
        break;
      }

      if (result.decision === "decline") {
        outcome = "disengaged";
        finalReasoning = result.reasoning;
        break;
      }

      if (result.decision === "defer") {
        outcome = "deferred";
        finalReasoning = result.reasoning;
        break;
      }

      if (result.decision === "extend" && result.extendReason) {
        // Allow extensions up to absolute max of 5 turns (consistent with graph behavior)
        if (effectiveMaxTurns < 5) {
          effectiveMaxTurns = Math.min(effectiveMaxTurns + 1, 5);
          logger.verbose("runSingleNegotiation: extended max turns", {
            negotiationId,
            newMaxTurns: effectiveMaxTurns,
            reason: result.extendReason,
          });
        }
      }

      currentTurn++;
    }

    // If we exhausted turns without a decision, default to deferred
    if (outcome === "disengaged" && currentTurn >= effectiveMaxTurns) {
      outcome = "deferred";
      finalReasoning = "Negotiation reached max turns without resolution";
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("runSingleNegotiation: error", {
      negotiationId,
      candidateUserId,
      error: err.message,
    });
    finalReasoning = `Negotiation error: ${err.message}`;
  }

  // Persist negotiation to database
  try {
    const participants: NegotiationParticipant[] = [
      { userId: userId, role: 'initiator' },
      { userId: candidateUserId, role: 'responder' },
    ];

    const resolution: NegotiationResolution | null = outcome !== 'disengaged' ? {
      reasoning: finalReasoning,
      outcome,
    } : null;

    await db.insert(schema.negotiations).values({
      id: negotiationId,
      status: 'resolved',
      outcome,
      participants,
      trigger,
      turns,
      resolution,
      currentTurn: turns.length,
      maxTurns: effectiveMaxTurns,
    });

    logger.verbose("runSingleNegotiation: persisted to database", {
      negotiationId,
      candidateUserId,
      outcome,
      turns: turns.length,
    });
  } catch (dbError) {
    const err = dbError instanceof Error ? dbError : new Error(String(dbError));
    logger.error("runSingleNegotiation: failed to persist", {
      negotiationId,
      candidateUserId,
      error: err.message,
    });
  }

  // Emit end event
  streamProgress?.({
    type: "negotiation_end",
    negotiationId,
    candidateUserId,
    candidateName,
    outcome,
    reasoning: finalReasoning,
  });

  return {
    candidateUserId,
    candidateName,
    outcome,
    turns,
    reasoning: finalReasoning,
    candidate,
  };
}
