import { HttpException, HttpStatus, Inject, Injectable, Logger, StreamableFile } from '@nestjs/common';

import { Chroma } from '@langchain/community/vectorstores/chroma';
import { QuestionGenerationInput, RetrievalQuestionInput } from '../schema/chat.schema';

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


    async generate(indexId: string) {
        
        const chain = await this.agentClient.createQuestionGenerationChain('OpenAI');
        Logger.log(`Created chain for ${indexId}`, 'chatService:generate')

        Logger.log(`Created vector store for ${indexId}`, 'chatService:generate')

        const response = await this.chromaClient.collection.get({
            where: {
                indexId: indexId,
            }
        });

        Logger.log(`Retrieved ${JSON.stringify(response)} documents`, 'chatService:generate')

        Logger.log(`Retrieved ${response.documents.length} documents`, 'chatService:generate')

        if (response.ids.length === 0) throw new HttpException('No documents have found', HttpStatus.NOT_FOUND);

        const questions = await chain.invoke({
            documents: response.documents
        });

        return questions;

    }

}