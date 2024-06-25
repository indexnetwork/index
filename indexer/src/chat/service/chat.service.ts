import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { Chroma } from '@langchain/community/vectorstores/chroma';
import { RetrievalQuestionInput } from '../schema/chat.schema';

import { Agent } from 'src/app/modules/agent.module';
import { RunnableSequence } from '@langchain/core/runnables';
import { pull } from 'langchain/hub';

@Injectable()
export class ChatService {
  constructor(
    @Inject('AGENT_METACLASS') private readonly agentClient: Agent,
    @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
  ) {
    // FUTURE:
  }

  /**
   * @description Stream a question to the agent with a chat history
   *
   * @param body
   * @returns
   */
  async stream(body: RetrievalQuestionInput) {
    Logger.log(`Processing ${JSON.stringify(body)}`, 'chatService:stream');

    try {
      // Initialize the agent

      const answerPrompt = await pull(
        body.input.question
          ? process.env.PROMPT_ANSWER_TAG
          : process.env.PROMPT_RELEVANCY_CHECK_TAG,
      );
      const chain: RunnableSequence = await this.agentClient.createAgentChain(
        body.chain_type,
        body.indexIds,
        body.model_type,
        body?.model_args,
        answerPrompt,
      );
      if (body.input.question) {
        const stream = await chain.stream({
          question: body.input.question,
          chat_history: body.input.chat_history,
        });
        return stream;
      } else if (body.input.information) {
        const stream = await chain.stream({
          information: body.input.information,
          chat_history: body.input.chat_history,
        });
        return stream;
      }
      // Invoke the agent
    } catch (e) {
      Logger.log(
        `Cannot process ${body.input.question} ${e}`,
        'chatService:stream:error',
      );
      throw e;
    }
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
      Logger.log(
        `Cannot process ${body.input.question} ${e}`,
        'chatService:stream:error',
      );
      throw e;
    }
  }

  async questions(indexIds: string[]) {
    const chain =
      await this.agentClient.createQuestionGenerationChain('OpenAI');
    Logger.log(
      `Created chain for ${JSON.stringify(indexIds)}`,
      'chatService:questions',
    );

    Logger.log(
      `Created vector store for ${JSON.stringify(indexIds)}`,
      'chatService:questions',
    );

    const response = await this.chromaClient.collection.get({
      where: {
        indexId: { $in: indexIds },
      },
      limit: 10,
    });

    Logger.log(
      `Retrieved ${response.ids.length} documents`,
      'chatService:questions',
    );

    Logger.log(
      `Retrieved ${response.documents.length} documents`,
      'chatService:questions',
    );

    if (response.ids.length === 0)
      throw new HttpException('No documents have found', HttpStatus.NOT_FOUND);

    const resp = await chain.invoke({
      documents: response.documents,
    });

    if (resp.questions && resp.questions.length > 4) {
      resp.questions = resp.questions.slice(0, 4);
    }

    return resp;
  }
}
