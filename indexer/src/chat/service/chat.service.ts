import { HttpException, HttpStatus, Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';

import { Chroma } from '@langchain/community/vectorstores/chroma';
import { RetrievalQuestionInput } from '../schema/chat.schema';

import { Agent } from 'src/app/modules/agent.module';
import { RunnableSequence } from '@langchain/core/runnables';


@Injectable()
export class ChatService {

    constructor(
        @Inject('AGENT_METACLASS') private readonly agentClient: Agent,
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

        Logger.log(`Processing ${JSON.stringify(body)}`, 'chatService:stream')

        try {
            // Initialize the agent
            const chain: RunnableSequence = await this.agentClient.createAgentChain(body.chain_type, body.indexIds, body.model_type);

            // Invoke the agent
            const stream = await chain.stream({ 
                question: body.input.question, 
                chat_history: body.input.chat_history
            });

            return stream;
        
        } catch (e) {
            Logger.log(`Cannot process ${body.input.question} ${e}`, 'chatService:stream:error'); throw e;
        }

    }
}