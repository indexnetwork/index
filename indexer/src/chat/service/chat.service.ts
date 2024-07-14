import { Inject, Injectable, Logger } from '@nestjs/common';

import { Agent } from 'src/app/modules/agent.module';

@Injectable()
export class ChatService {
  constructor(@Inject('AGENT_METACLASS') private readonly agentClient: Agent) {
    // FUTURE:
  }

  /**
   * @description Stream a question to the agent with a chat history
   *
   * @param body
   * @returns
   */
  async streamExternal(body: any) {
    Logger.log(
      `Processing ${JSON.stringify(body)}`,
      'chatService:streamExternal',
    );
    try {
      return await this.agentClient.createDynamicChain(body);
      // Invoke the agent
    } catch (e) {
      Logger.log(`Cannot process ${body} ${e}`, 'chatService:stream:error');
      throw e;
    }
  }
}
