import type { ConversationMessage } from '@indexnetwork/agent';

import type { TuiConversation, TuiMessage, TuiQuestion } from './negotiation.tui.js';

/** Negotiator bookkeeping: stored on the conversation, never shown in it. */
const BOOKKEEPING = new Set<string>(['brief', 'decision', 'stall']);

/** In-memory host storage and H2A view for one principal's intent conversation. */
export class ConversationStore implements TuiConversation {
  private readonly conversationId = crypto.randomUUID();
  private readonly messages: ConversationMessage[] = [];
  private readonly visible: TuiMessage[] = [];
  private readonly questions = new Map<string, TuiQuestion>();
  private stopped = false;

  /**
   * @param principal - The owner and intent of this conversation.
   * @param onInput - Notifies the runner after human input has been saved.
   * @param onChange - Notifies the view after each append batch.
   */
  constructor(
    private readonly principal: { userId: string; name: string; intentId: string },
    private readonly onInput: () => void,
    private readonly onChange: () => void,
  ) {}

  get conversation(): readonly TuiMessage[] { return this.visible; }
  get pending(): TuiQuestion | null { return this.questions.values().next().value ?? null; }
  get queuedQuestions(): number { return Math.max(0, this.questions.size - 1); }

  /**
   * @param messages - Structured entries in oldest-first order.
   * @returns Nothing; the entries are saved before the view is notified.
   * @throws If the store has stopped.
   */
  append(messages: TuiMessage[]): void {
    if (this.stopped) throw new Error('Conversation has stopped');
    for (const entry of structuredClone(messages)) {
      this.messages.push({
        id: entry.id,
        conversationId: this.conversationId,
        senderId: this.principal.userId,
        senderName: entry.source === 'host' ? 'Host' : this.principal.name,
        role: entry.kind === 'user' || entry.kind === 'answer' ? 'user' : 'agent',
        parts: [{ kind: 'text', text: entry.text }],
        createdAt: entry.createdAt,
        metadata: { intentId: this.principal.intentId, principalMessage: entry },
      });
      if (!BOOKKEEPING.has(entry.kind)) {
        this.visible.push(entry);
      }
      if (entry.kind === 'question' && entry.questionId && !this.questions.has(entry.questionId)) {
        this.questions.set(entry.questionId, entry as TuiQuestion);
      } else if ((entry.kind === 'answer' || entry.kind === 'expire') && entry.questionId) {
        this.questions.delete(entry.questionId);
      }
    }
    this.onChange();
  }

  /** @returns A fresh copy of all runner-wire messages, including bookkeeping. */
  read(): { conversationId: string; messages: ConversationMessage[] } {
    return { conversationId: this.conversationId, messages: structuredClone(this.messages) };
  }

  /** @returns Nothing; further writes are rejected while saved messages remain readable. */
  stop(): void { this.stopped = true; }

  /**
   * @param text - Human input for this intent.
   * @returns Whether nonempty input was saved before notifying the runner.
   */
  async message(text: string): Promise<boolean> {
    text = text.trim();
    if (this.stopped || !text) return false;
    this.append([{
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: 'user',
      scope: 'intent', matches: [], text,
    }]);
    this.onInput();
    return true;
  }

  /**
   * @param questionId - Any still-open question in this conversation.
   * @param text - The human's reply.
   * @returns Whether nonempty input answered the question before notifying the runner.
   */
  async answer(questionId: string, text: string): Promise<boolean> {
    text = text.trim();
    const question = this.questions.get(questionId);
    if (this.stopped || !text || !question) return false;
    this.append([{
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: 'answer',
      questionId, scope: question.scope, matches: question.matches, text,
    }]);
    this.onInput();
    return true;
  }
}
