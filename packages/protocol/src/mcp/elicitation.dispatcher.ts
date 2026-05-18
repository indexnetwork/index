import type { Question } from "../shared/schemas/question.schema.js";
import type { ChatMessageWriter } from "../shared/interfaces/chat-message-writer.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { buildElicitationCreate, flattenChoice } from "./elicitation.builder.js";

const logger = protocolLogger("McpElicitation");

export type ElicitResultLike =
  | { action: "accept"; content?: { choice?: unknown } }
  | { action: "decline" }
  | { action: "cancel" };

export type ElicitInputFn = (
  params: ReturnType<typeof buildElicitationCreate>,
) => Promise<ElicitResultLike>;

export interface DispatchElicitationsParams {
  userId: string;
  questions: Question[];
  elicitInput: ElicitInputFn;
  /**
   * Optional. When absent, elicitations still dispatch (so users aren't
   * left mid-flow on a misconfiguration), but accepted answers are dropped
   * with a one-shot warn. See dispatcher body.
   */
  chatMessageWriter?: ChatMessageWriter;
}

/** Narrowing guard for elicitation replies received from MCP clients. */
function isElicitResult(value: unknown): value is ElicitResultLike {
  if (typeof value !== "object" || value === null) return false;
  const action = (value as { action?: unknown }).action;
  return action === "accept" || action === "decline" || action === "cancel";
}

/**
 * Sequentially dispatches one `elicitation/create` per question. On accept,
 * flattens the choice and posts it via the ChatMessageWriter. `cancel` breaks
 * the loop; `decline` is a no-op. A transport throw breaks the loop with a
 * warning. An addUserMessage throw logs and continues (doesn't halt the loop).
 * Empty `questions` is a no-op.
 *
 * Caller is responsible for the capability check — this function only knows
 * how to dispatch.
 */
export async function dispatchElicitations({
  userId,
  questions,
  elicitInput,
  chatMessageWriter,
}: DispatchElicitationsParams): Promise<void> {
  if (questions.length === 0) return;

  if (!chatMessageWriter) {
    // Misconfiguration: composition root forgot to wire the writer. We still
    // proceed with elicitations so the user isn't silently left hanging, but
    // surface the gap once at loop start so it's visible in protocol logs.
    logger.warn("chat_message_writer_absent_responses_will_drop", {
      userId,
      questionCount: questions.length,
    });
  }

  for (const question of questions) {
    const elicitation = buildElicitationCreate(question);
    let rawReply: unknown;
    try {
      rawReply = await elicitInput(elicitation);
    } catch (err) {
      logger.warn("elicitation_failed", {
        title: question.title,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    // The reply is runtime data from the MCP client — validate the shape
    // before branching. A malformed reply (null, missing action, unknown
    // action) is treated as a no-op so we don't persist anything unsafe.
    if (!isElicitResult(rawReply)) {
      logger.warn("elicitation_response_malformed", { title: question.title });
      continue;
    }
    const reply = rawReply;

    if (reply.action === "cancel") break;
    // Require an explicit `accept` — `decline` and any future / unknown
    // action both fall through to no-op rather than being treated as
    // accepted responses.
    if (reply.action !== "accept") continue;

    const flat = flattenChoice(question, reply.content?.choice);
    if (flat === null) continue;
    if (!chatMessageWriter) continue;

    try {
      const writeResult = await chatMessageWriter.addUserMessage(userId, flat);
      if (writeResult === null) {
        // User has no chat session — the accepted answer is dropped here.
        // Day-one behavior: log and continue. Future iterations may surface
        // the answer back through the tool result envelope for clients to
        // resurface, but that's out of scope for this slice.
        logger.warn("chat_message_write_skipped_no_session", {
          userId,
          title: question.title,
        });
      }
    } catch (err) {
      logger.warn("chat_message_write_failed", {
        title: question.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
