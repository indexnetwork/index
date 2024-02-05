import { Inject, Injectable, Logger } from '@nestjs/common';

import { Chroma } from '@langchain/community/vectorstores/chroma';
import { QueryQuestionInput, RetrievalQuestionInput } from '../schema/chat.schema';

import * as fs from "fs";
import { Agent } from 'src/app/modules/agent.module';
import { SelfQueryRetriever } from 'langchain/retrievers/self_query';
import { CallbackManagerForRetrieverRun } from '@langchain/core/callbacks/manager';


@Injectable()
export class ChatService {

    constructor(
        @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
        @Inject('AGENT_METACLASS') private readonly agentClient: Agent,
    ) {

        // TODO: Add Streaming to chain output
        // TODO: Add query endpoint
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
            const chain = await this.agentClient.createAgentChain(body.chain_type, body.index_id, body.model_type);

            // Invoke the agent
            const stream = await chain.invoke({ 
                question: body.input.question, 
                chat_history: body.input.chat_history 
            });


            // const stream = await chain.streamLog({ 
            //    question: body.input.question, 
            //    chatHistory: body.input.chat_history 
            // });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // let aggregate: any = {};

            // for await (const chunk of stream) {
            //     console.log(JSON.stringify(chunk));

            //     // You can also reconstruct the log using the `applyPatch` function.
            //     // aggregate = applyPatch(aggregate, chunk.ops).newDocument;
            //     // console.log();
            // }

            // console.log("aggregate", aggregate);

            return {
                'answer': stream.answer,
                'source': stream.sources
            }
        
        } catch (e) {
            Logger.log(`Cannot process ${body.input.question} ${e}`, 'chatService:stream:error'); throw e;
        }

    }

    /**
     * @description Generate a query from question with the agent without a chat history
     * 
     * @param body 
     * @returns 
     */
    async query(body: QueryQuestionInput): Promise<{ sources: any[] }>{
            
        Logger.log(`Processing ${JSON.stringify(body)}`, 'chatService:query')

        try {
            
            const retriever: SelfQueryRetriever<Chroma> = await this.agentClient.createRetrieverChain(
                body.chain_type, 
                body.index_id, 
                body.model_type, 
                body.k * (body.page + 1)
            );

            const documents = await retriever.getRelevantDocuments(body.question);
            

            return {
                sources: documents.slice(body.k * body.page, body.k * (body.page + 1))
            }
        
        } catch (e) {
            Logger.log(`Cannot process ${body.question} ${e}`, 'chatService:query:error'); throw e;
        }

    }
}