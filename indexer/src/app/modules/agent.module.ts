import { ChatOpenAI, OpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { AIMessagePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, PromptTemplate } from "@langchain/core/prompts";
import { ConversationalRetrievalQAChain, LLMChain, RetrievalQAChain } from "langchain/chains";
import { RunnableBranch, RunnableLambda, RunnableParallel, RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { formatDocumentsAsString } from "langchain/util/document";

import { DynamicModule, Inject, Logger, Module } from '@nestjs/common';
import { ChromaModule } from './chroma.module';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { pull } from "langchain/hub";
import { AttributeInfo } from "langchain/schema/query_constructor";
import { SelfQueryRetriever } from "langchain/retrievers/self_query";
import { ChromaTranslator } from "langchain/retrievers/self_query/chroma";
import { ChatMistralAI } from '@langchain/mistralai';


export class Agent {

	private apiKey: string;

    // RESEARCH TODOS:
        // TODO: Also add method type -> reAcT , selfAsk, etc
        // TODO: Can we also add context type by intent find?
        // TODO: Research on low-computation models for subtasks


    // IMPLEMENTATION TODOS:
        // TODO: Add initial filtering according to the index (rag)
        // TODO: Add initial filtering according to the index (retriever)
        // TODO: Add standalone question pipeline

	constructor (
    ) {
        const apiKey = process.env.OPENAI_API_KEY;

		if (!apiKey) throw new Error('OpenAI API key is required');

		this.apiKey = apiKey;
	}

    public async createAgentChain(chain_type: string = 'rag-v0', indexIds: string[], model_type: string = 'OpenAI'): Promise<any> {

        switch (chain_type) {

            case 'rag-v0':
                return this.createRAGChain(indexIds, model_type);

            default:
                throw new Error('Chain type not supported');   
        }
    }

    public async createRetrieverChain(chain_type: string = 'query-v0', index_ids: string[], model_type: string = 'OpenAI', page: number, limit: number): Promise<any> {

        switch (chain_type) {

            case 'query-v0':
                return this.createQueryRetriever(index_ids, model_type, page, limit);

            default:
                throw new Error('Chain type not supported');   
        }
    }


    private async createRAGChain (chroma_indices: string[], model_type: string): Promise<any>{

        let model: any;
        if (model_type == 'OpenAI') { 
            model = new ChatOpenAI({ 
                modelName:  process.env.MODEL_CHAT,
                streaming: true,
            }) 
        } else if (model_type == 'MistralAI') { model = new ChatMistralAI({ modelName: process.env.MISTRAL_MODEL_CHAT, apiKey: process.env.MISTRAL_API_KEY }) }

        const vectorStore = await Chroma.fromExistingCollection( 
            new OpenAIEmbeddings({ modelName: process.env.MODEL_EMBEDDING}),
            { 
                url: process.env.CHROMA_URL, 
                collectionName: process.env.CHROMA_COLLECTION_NAME, 
                filter: {
                    indexId: {
                        $in: chroma_indices
                    }
            }
        });
        
        const documentCount = await vectorStore.collection.count();
        if (!documentCount) throw new Error('Vector store not found');

        const retriever = vectorStore.asRetriever();

        
        // TODO: Prior information context -> glossary, etc.
        // Prompt link: https://langstream.ai/2023/10/13/rag-chatbot-with-conversation/
        const questionPrompt = PromptTemplate.fromTemplate(`
            Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question, in its original language.

            The user will give you a question without context. You will reformulate the question to take into account the context of the conversation. 
            You should also consult with the Chat History below when reformulating the question. 
            For example, you will substitute pronouns for mostly likely noun in the conversation history. 

            When reformulating the question give higher value to the latest question and response in the Chat History. 
            The chat history is in reverse chronological order, so the most recent exchange is at the top.

            Chat History:
            {chat_history}
            ----------------
            Follow Up Input: {question}
            ----------------
            Standalone question:
        `);

        const answerPrompt = PromptTemplate.fromTemplate(`
            Answer the question based only on the following context:
            ----------------
            CONTEXT: {context}
            ----------------
            QUESTION: {question}
        `);

        const formatChatHistory = (chatHistory: string | string[]) => {
            if (Array.isArray(chatHistory)) {
                const updatedChat =  chatHistory.map(
                    (dialogTurn: any) => {
                        if (dialogTurn['role'] == 'human') { return `Human: ${dialogTurn['content']}` }
                        if (dialogTurn['role'] == 'assistant') { return `AI: ${dialogTurn['content']}` }
                    }
                ).join("\n");
                Logger.log(updatedChat, "ChatService:formatChatHistory");
                return updatedChat;
            }
            return '';
        }

        // const selfAskPrompt = await pull("hwchase17/self-ask-with-search")
        const standalone_question = RunnableSequence.from([
            {
                question: (input) => input.question,
                chat_history: (input) => formatChatHistory(input.chat_history),
            },
            questionPrompt,
            model,
            new StringOutputParser(),
        ]);

        const answerChain = RunnableSequence.from([
            {
                context: RunnableSequence.from([
                    retriever as any,
                    {
                        docs: (input) => {
                            return input
                        },
                    },
                ]),
                question: new RunnablePassthrough(),
            },
            {
                answer: RunnableSequence.from([
                    {
                        context: (input) => {

                            // Logger.log(input.context, "ChatService:answerChain:inputContext");
                            const docs_with_metadata = input.context.docs.map((doc: any) => {
                                return JSON.stringify(doc.metadata) + "\n" + doc.pageContent
                            })
                            // const serialized = formatDocumentsAsString(input.context.docs)
                            const serialized = docs_with_metadata.join("\n");
                            // Logger.log(serialized?.length, "ChatService:answerChain:contextLength");
                            return serialized
                        },
                        question:  (input) => {
                            Logger.log(input.question, "ChatService:answerChain:inputQuestion");
                            return input.question
                        },
                    },
                    answerPrompt,
                    model,
                    new StringOutputParser(),
                ]),
                sources: RunnableLambda.from((input) => {
                    return input.context.docs.map((doc: any) => { 
                        return doc.metadata 
                    })
                }),

            }
        ])

        const final_chain = standalone_question.pipe(answerChain);
        
        return final_chain

    }

    private async createQueryRetriever (chroma_indices: string[], model_type: string, page: number, limit: number) {

        // Not implemented yet
        // https://js.langchain.com/docs/modules/data_connection/retrievers/self_query/chroma-self-query


        let model: any;
        if (model_type == 'OpenAI' ) { model = new ChatOpenAI({ modelName:  process.env.MODEL_CHAT }) }
        else if (model_type == 'MistralAI') { model = new ChatMistralAI({ modelName: process.env.MISTRAL_MODEL_CHAT, apiKey: process.env.MISTRAL_API_KEY }) }

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
                                $in: chroma_indices
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
                        nResults: (page * limit),
                    })
                    return docs
                }
            },
            {
                documents: (input) => {
                    // Return ids and similarities
                    const ids = input.documents?.ids[0]
                    const similarities = input.documents?.distances[0]
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
                return input.documents.slice((page-1)*limit, page*limit)
            })
        ]);
        
        return final_chain;
    }


    //* Helper functions

}


@Module({
    imports: [ChromaModule],
    controllers: [],
    providers: [],
    exports: [],
})
export class AgentModule {
	static register (): DynamicModule {

		Logger.debug('Registering AgentModule...', 'AgentModule:register');
		
        return {
			module: AgentModule,
            global: true,
			providers: [{

				provide: 'AGENT_METACLASS',
				useFactory: (): Agent => {
					return new Agent();
				}

			}],
			exports: ['AGENT_METACLASS'],
		}
	}
}
