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
import { IncludeEnum } from 'chromadb';


@Injectable()
export class SearchService {

    constructor(
        @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
        @Inject('AGENT_METACLASS') private readonly agentClient: Agent,
    ) {}


    async autocomplete(body: AutocompleteRequestDTO): Promise<any> {

        const docs = await this.chromaClient.collection.get({
            where: {
                indexId: body.indexId,
            }
        })

        const context = docs.metadatas.map((doc: any) => doc.webPageTitle).join('\n');
        // const context = docs.documents.join('');
        const message = `
        Provide a list of ${body.n} suggestions for autocompleting containing max 3-4 words have the string and content below:
        --------
        String: ${body.query}
        --------
        Content:
        ${context.slice(0, 10000)}
        `

        // Logger.log(`Autocompleting ${body.query} via ${message}`, 'chatService:autocomplete');

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                {"role": "system", "content": message },
                {"role": "user", "content": ``}
            ],
        });

        const suggestions = completion.choices[0].message.content.split('\n').map((suggestion: string) => suggestion.replace(/^\d+\.\s/g, '') );

        return {
            suggestions: suggestions
        }
    }

    /**s
     * @description Suggest a list of documents for a given query and index
     * Currently, the service uses the OpenAI GPT-4 model to generate suggestions and then retrieves the documents from the ChromaDB
     * The ranking of the documents is based on the similarity of the expanded query from suggestions and the document
     *
     * @param body
     * @returns
     */
    async query(body: QueryRequestDTO): Promise<any> {

        Logger.log( `Processing ${JSON.stringify(body)}`, 'chatService:query')

        try {

            const embeddings = new OpenAIEmbeddings({ modelName: process.env.MODEL_EMBEDDING, openAIApiKey: process.env.OPENAI_API_KEY });

            Logger.log(`Retrieving documents for ${body.query}`, 'chatService:query');

            // Calculate time to suggestions
            const start_exp = new Date().getTime();

            const expandedQuery = await this.autocomplete({
                indexId: body.indexIds[0],
                n: 3,
                query: body.query
            });


            const end_exp = new Date().getTime();
            const time = end_exp - start_exp;

            Logger.log(`Retrieved suggestion list ${JSON.stringify(expandedQuery, null, 2)} in ${time}ms`, 'chatService:query');


            const start_retrieve = new Date().getTime();

            const documents = await this.chromaClient.collection.query({
                queryEmbeddings: await embeddings.embedQuery(body.query + ' ' + expandedQuery.suggestions.join(' ')),
                nResults: 10,
                where: {
                    indexId: body.indexIds[0]
                },
                include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances]
            });

            // Define softmax function
            const softmax = (x: number[]) => {
                const e = x.map((xi: number) => Math.exp(xi));
                const sum = e.reduce((a, b) => a + b, 0);
                return e.map((ei: number) => ei / sum);
            }

            // Normalize distances and expand values
            const distances = documents.distances[0].map((distance: number) => 1 - distance)
            const normalizedDistances = softmax(distances.map((distance: number) => distance * 100 ));

            const end_retrieve = new Date().getTime();

            Logger.log(`Retrieved documents in ${end_retrieve - start_retrieve}ms`, 'chatService:query');

            return documents.ids[0].map((id: any, idx: number) => {
                if (normalizedDistances[idx] > 0.1)
                    return {
                        id: documents.metadatas[0][idx].id,
                        similarity: normalizedDistances[idx]
                    }
            })
            .filter((doc: any) => doc)
            .slice((body.page - 1) * body.limit, body.page * body.limit)

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
