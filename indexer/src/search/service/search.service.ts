import { Chroma } from '@langchain/community/vectorstores/chroma';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SelfQueryRetriever } from 'langchain/retrievers/self_query';
import { Agent } from 'src/app/modules/agent.module';
import { QueryRequestDTO, SearchRequestDTO } from '../schema/search.schema';
import { LLMChain } from 'langchain/chains';
import { RunnableSequence, RunnableLambda } from '@langchain/core/runnables';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { IncludeEnum } from 'chromadb';

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

            const embeddings = new OpenAIEmbeddings({ modelName: process.env.MODEL_EMBEDDING, openAIApiKey: process.env.OPENAI_API_KEY });

            const response = await this.chromaClient.collection.query({
                queryEmbeddings: await embeddings.embedQuery(body.query),
                nResults: body.page * body.limit,
                include: [IncludeEnum.Metadatas, IncludeEnum.Distances],
                where:{     
                    indexId: {
                        $in: body.indexIds
                    }
                }
            })

            const documents = response.metadatas[0].map(function(doc: any, idx: number) {
                Logger.log(`Processing ${JSON.stringify(doc)} with ${idx}`, 'chatService:query:document');
                return {
                    id: doc?.webPageId,
                    similarity: response.distances[0][idx],
                };
            });

            return {
                items: documents.slice((body.page - 1) * body.limit, body.page * body.limit),
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
