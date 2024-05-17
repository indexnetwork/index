import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  StreamableFile,
} from '@nestjs/common';

import { Chroma } from '@langchain/community/vectorstores/chroma';
import {
  QuestionGenerationInput,
  RetrievalQuestionInput,
} from '../schema/chat.schema';

import { Agent } from 'src/app/modules/agent.module';
import { RunnableSequence } from '@langchain/core/runnables';
import { OpenAIEmbeddings } from '@langchain/openai';

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
      const chain: RunnableSequence = await this.agentClient.createAgentChain(
        body.chain_type,
        body.indexIds,
        body.model_type,
        body?.model_args,
      );

      // Invoke the agent
      const stream = await chain.stream({
        question: body.input.question,
        chat_history: body.input.chat_history,
      });

      return stream;
    } catch (e) {
      Logger.log(
        `Cannot process ${body.input.question} ${e}`,
        'chatService:stream:error',
      );
      throw e;
    }
  }

  async questions(indexIds: string[]) {
    console.log(`seref`, indexIds);
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

    const questions = await chain.invoke({
      documents: response.documents,
    });

    return questions;
  }
}
