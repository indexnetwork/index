import type { ChatMessage } from '../spec/types';

export class ChatBridge {
  constructor(private adapter: any) {}

  async receiveMessage(message: ChatMessage): Promise<void> {
    await this.adapter.createOrGetSession(message.sessionId, message.from, message.to);
    await this.adapter.insertMessage({
      sessionId: message.sessionId,
      role: 'user',
      content: message.content,
      metadata: message.context ? { context: message.context } : undefined,
    });
  }
}
