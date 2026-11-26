import { AGENT_DM_ID, ConversationService } from '../../services/conversation.service';

import { HISTORY_TURNS, messageText, runPersonalAgent } from './personal-agent';
import { PERSONAL_SCOPE } from './personal-agent.instructions';

/** Longest owner message the personal agent takes in one turn. */
export const MAX_TURN_TEXT = 4000;

/** Where an owner's message came from. Email turns tell the model, and are tagged in the chat. */
export type TurnSource = 'home' | 'email';

/** Owners with a turn running, and the turn each new one waits behind. */
const running = new Map<string, Promise<unknown>>();

/** True while a personal agent turn is running for this owner. */
export function isTurnRunning(userId: string): boolean {
  return running.has(userId);
}

/**
 * Run one owner's turns one at a time: a turn that arrives while another is
 * running starts when that one ends.
 */
function queued<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const before = running.get(userId) ?? Promise.resolve();
  const next = before.catch(() => undefined).then(work);
  const tracked = next.finally(() => {
    if (running.get(userId) === tracked) running.delete(userId);
  });
  running.set(userId, tracked);
  return next;
}

export type TurnResult =
  | { ok: true; message: unknown; reply: unknown; text: string; changed: string[] }
  | { ok: false; message: unknown; error: string };

/**
 * Store the owner's message in the personal agent chat, run one agent turn on
 * the chat so far, and store the agent's answer.
 *
 * @param input - The owner, their name, what they said, and where they said it.
 * @returns The stored messages and the agent's text, or the stored owner message and an error when the model failed.
 * @throws When the chat can't be read or written.
 */
export function takePersonalTurn(
  conversations: ConversationService,
  input: { userId: string; userName?: string | null; text: string; source?: TurnSource },
): Promise<TurnResult> {
  return queued(input.userId, async () => {
    const source = input.source ?? 'home';
    const resolved = await conversations.resolveId(AGENT_DM_ID, input.userId);
    if ('error' in resolved) throw new Error(resolved.error);
    const conversationId = resolved.id;

    const history = await conversations.getMessages(conversationId, { userId: input.userId, scope: PERSONAL_SCOPE, limit: HISTORY_TURNS });
    const message = await conversations.sendMessage(conversationId, input.userId, 'user', [{ kind: 'text', text: input.text }], {
      metadata: { scope: PERSONAL_SCOPE, ...(source === 'email' ? { via: 'email' } : {}) },
    });

    // The model is told an email turn came by email, so it answers for an inbox and not for Home.
    const said = source === 'email'
      ? `(I'm replying by email to your last email. Your answer goes back to me by email.)\n\n${input.text}`
      : input.text;

    let reply;
    try {
      reply = await runPersonalAgent({
        userId: input.userId,
        userName: input.userName,
        turns: [
          ...history.map((entry) => ({ role: entry.role, text: messageText(entry.parts) })),
          { role: 'user' as const, text: said },
        ],
      });
    } catch (err: unknown) {
      return { ok: false as const, message, error: err instanceof Error ? err.message : String(err) };
    }

    const answer = await conversations.sendAgentMessage(conversationId, [{ kind: 'text', text: reply.text }], {
      metadata: { scope: PERSONAL_SCOPE, ...(reply.changed.length ? { changed: reply.changed } : {}), ...(source === 'email' ? { via: 'email' } : {}) },
    });
    return { ok: true as const, message, reply: answer, text: reply.text, changed: reply.changed };
  });
}
