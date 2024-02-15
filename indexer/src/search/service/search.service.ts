import { Chroma } from '@langchain/community/vectorstores/chroma';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SelfQueryRetriever } from 'langchain/retrievers/self_query';
import { Agent } from 'src/app/modules/agent.module';
import { QueryRequestDTO, SearchRequestDTO } from '../schema/search.schema';
import { LLMChain } from 'langchain/chains';
import { RunnableSequence, RunnableLambda } from '@langchain/core/runnables';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

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

            const embeddings = new OpenAIEmbeddings({
                verbose: true,
                openAIApiKey: process.env.OPENAI_API_KEY, 
                modelName: process.env.MODEL_EMBEDDING
            })

            Logger.log(`Creating vector store with ${process.env.MODEL_EMBEDDING} embeddings`, "Agent:createQueryRetriever");

            const vectorStore = await Chroma.fromExistingCollection( 
                embeddings,
                { 
                    url: process.env.CHROMA_URL, 
                    collectionName: process.env.CHROMA_COLLECTION_NAME, 
                    filter: { 
                        $and: [
                            {
                                indexId: {
                                    $in: body.indexIds
                                }
                            },
                            {
                                webPageContent: {
                                    $exists: true
                                }
                            }
                        ]
                }
            });

            const final_chain = RunnableSequence.from([
                {
                    documents: async (input) => {
                        // Get embeddings of the query
                        const queryEmbedding = await embeddings.embedQuery(input.query)
                        // Fetch most similar semantic content according to query
                        const docs = await vectorStore.collection.query({
                            queryEmbeddings: [queryEmbedding],
                            // nResults: (body.page * body.limit),
                            where: {     
                                indexId: {
                                    $in: body.indexIds
                                }
                            }
                        })
                        return docs
                    }
                },
                {
                    documents: (input) => {
                        // Return ids and similarities
                        const ids = input.documents?.ids[0]
                        const similarities = input.documents?.distances[0]
                        // TODO: Fix chunk retrieval
                        return ids.map(function(id, i) {
                            return {
                                id: id,
                                similarity: similarities[i],
                            };
                        });
                    }
                },
                // Add pagination to retrieved documents
                RunnableLambda.from((input) => {
                    return input.documents.slice((body.page-1)*body.limit, body.page*body.limit)
                })
            ]);
            
            const documents = await final_chain.invoke({
                query: body.query,
            });

            
            return {
                items: documents
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
