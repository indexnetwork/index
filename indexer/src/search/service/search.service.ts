import { Chroma } from '@langchain/community/vectorstores/chroma';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Agent } from 'src/app/modules/agent.module';
import { AutocompleteRequestDTO, QueryRequestDTO, SearchRequestDTO } from '../schema/search.schema';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { HydeRetriever } from "langchain/retrievers/hyde";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Completion, Completions } from 'openai/resources';
import OpenAI from 'openai';
import { Document } from "@langchain/core/documents";


@Injectable()
export class SearchService {

    constructor(
        @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
        @Inject('AGENT_METACLASS') private readonly agentClient: Agent,
    ) {}


    async autocomplete(body: AutocompleteRequestDTO): Promise<any> {

        // const completions = await Completions.call()

        const docs = await this.chromaClient.collection.get({
            where: {
                indexId: body.indexId,
            }
        })

        // Logger.log(`Docs ${JSON.stringify(docs.documents)}`, 'chatService:autocomplete');

        // const context = docs.metadatas.map((doc: any) => doc.webPageTitle).join('\n');
        const context = docs.documents.join('');
        const message = `
        Provide a list of ${body.n} suggestions for autocompleting containing max 3-4 words have the string and content below:
        --------
        String: ${body.query}
        --------
        Content: 
        ${context.slice(0, 10000)}
        `

        Logger.log(`Autocompleting ${body.query} via ${message}`, 'chatService:autocomplete');

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            // model: "gpt-4-turbo-preview",
            model: "gpt-3.5-turbo",
            logprobs: true,
            messages: [
                {"role": "system", "content": message },
                {"role": "user", "content": ``}
            ],
        });

        Logger.log(`Autocompleted ${JSON.stringify(completion)}`, 'chatService:autocomplete');

        const suggestions = completion.choices[0].message.content.split('\n').map((suggestion: string) => suggestion.replace(/^\d+\.\s/g, '') );

        
        return {
            suggestions: suggestions
        }
    }

    /**s
     * @description Generate a query from question with the agent without a chat history
     * 
     * @param body 
     * @returns 
     */
    async query(body: QueryRequestDTO): Promise<any> {
        
        Logger.log( `Processing ${JSON.stringify(body)}`, 'chatService:query')

        try {

            const embeddings = new OpenAIEmbeddings({ modelName: process.env.MODEL_EMBEDDING, openAIApiKey: process.env.OPENAI_API_KEY });
            
            const docs = await this.chromaClient.collection.get({
                where: {
                    indexId: body.indexIds[0],
                }
            })
                
            const texts = docs.documents
            const ids = docs.metadatas.map((doc: any) => {
                return { id: doc.webPageId, title: doc.webPageTitle }
            })

            Logger.log(`Creating vector store for ${ids}`, 'chatService:query')

            const vectorStore = await MemoryVectorStore.fromTexts(
                texts,
                ids,
                embeddings
            );

            const retriever = new HydeRetriever({
                vectorStore,
                llm: new ChatOpenAI({ modelName: process.env.MODEL_CHAT }) as any,
                searchType: 'mmr',
            });

            // const suggestions = await this.autocomplete({ indexId: body.indexIds[0], n: 5, query: body.query });

            Logger.log(`Retrieving documents for ${body.query}`, 'chatService:query');

            const documents = await retriever.getRelevantDocuments(
                body.query,
                
            );

            Logger.log(`Retrieved ${JSON.stringify(documents)} documents`, 'chatService:query');

            return {
                items: documents.map((doc: any) => { 
                    Logger.log(`Processing ${JSON.stringify(doc)}`, 'chatService:query')
                    return { 
                        webPageId: doc.metadata.id,
                        webPageTitle: doc.metadata.title,
                } } )
                .slice((body.page - 1) * body.limit, body.page * body.limit)
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
            })
            
        } catch (e) {
            Logger.log(`Cannot process`, 'chatService:search:error'); throw new HttpException(`Cannot process`, HttpStatus.INTERNAL_SERVER_ERROR);
        }

    }

}
