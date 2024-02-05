import { Chroma } from '@langchain/community/vectorstores/chroma';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SelfQueryRetriever } from 'langchain/retrievers/self_query';
import { Agent } from 'src/app/modules/agent.module';
import { QueryRequestDTO, SearchRequestDTO } from '../schema/search.schema';
import { LLMChain } from 'langchain/chains';

@Injectable()
export class SearchService {

    constructor(
        @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
        @Inject('AGENT_METACLASS') private readonly agentClient: Agent,
    ) {}

    /**
     * @description Generate a query from question with the agent without a chat history
     * 
     * @param body 
     * @returns 
     */
    async query(body: QueryRequestDTO): Promise<any> {
        
        Logger.log( `Processing ${JSON.stringify(body)}`, 'chatService:query')

        try {
            const retriever = await this.agentClient.createRetrieverChain(
                body.chainType, 
                body.indexIds,
                body.model,
                body.page,
                body.skip,
                10
            );

            const documents = await retriever.invoke({
                query: body.query,
            });

            return {
                sources: documents
            }
        
        } catch (e) {
            Logger.log(`Cannot process ${body.query} ${e}`, 'chatService:query:error'); throw new HttpException(`Cannot process ${body.query}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }


    /**
     * @description Stream a question to the agent with a chat history
     * @ignore
     * 
     * @param body 
     * @returns 
     */
    async search(body: SearchRequestDTO) {

        try {

            const results = await this.chromaClient.collection.query({
                queryEmbeddings: body.embedding,
                nResults: 10,
                where: body.filters,
                // include: ["metadata", "document"]
            })

            
        } catch (e) {
            Logger.log(`Cannot process`, 'chatService:search:error'); throw new HttpException(`Cannot process`, HttpStatus.INTERNAL_SERVER_ERROR);
        }

    }

}
