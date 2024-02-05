import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { Chroma } from '@langchain/community/vectorstores/chroma';
import { RetrievalQuestionInput } from '../schema/chat.schema';

import { Agent } from 'src/app/modules/agent.module';

@Injectable()
export class ChatService {

    constructor(
        @Inject('AGENT_METACLASS') private readonly agentClient: Agent,
    ) {
        // TODO: Add Streaming to chain output
        // TODO: Add multi-agent endpoint for each index
    }

    /**
     * @description Stream a question to the agent with a chat history
     * 
     * @param body 
     * @returns 
     */
    async stream(body: RetrievalQuestionInput): Promise<{ answer: string, source: string[]}> {

        Logger.log(`Processing ${JSON.stringify(body)}`, 'chatService:stream')

        try {
            
            // Initialize the agent
            const chain = await this.agentClient.createAgentChain(body.chain_type, body.indexIds, body.model_type);

            // Invoke the agent
            const stream = await chain.invoke({ 
                question: body.input.question, 
                chat_history: body.input.chat_history 
            });

            return {
                'answer': stream.answer,
                'source': stream.sources
            }
        
        } catch (e) {
            Logger.log(`Cannot process ${body.input.question} ${e}`, 'chatService:stream:error'); throw e;
        }

    }
}