import { ChatOpenAI, OpenAI } from '@langchain/openai';
import { TogetherAIEmbeddings } from '@langchain/community/embeddings/togetherai';

import { loadSummarizationChain } from 'langchain/chains';
import {
  RunnableLambda,
  RunnablePassthrough,
  RunnableSequence,
} from '@langchain/core/runnables';

import { DynamicModule, Logger, Module } from '@nestjs/common';
import { ChromaModule } from './chroma.module';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { pull } from 'langchain/hub';
import { ChatMistralAI } from '@langchain/mistralai';
import { ListOutputParser } from '@langchain/core/output_parsers';
import { TokenTextSplitter } from 'langchain/text_splitter';

enum SummarizationType {
  map_reduce = 'map_reduce',
  stuff = 'stuff',
  refine = 'refine',
}

export class Agent {
  private apiKey: string;

  // RESEARCH TODOS:
  // TODO: Also add method type -> reAcT , selfAsk, etc
  // TODO: Can we also add context type by intent find?
  // TODO: Research on low-computation models for subtasks

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) throw new Error('OpenAI API key is required');

    this.apiKey = apiKey;
  }

  public async createAgentChain(
    chain_type: string = 'rag-v0',
    indexIds: string[],
    model_type: string = 'OpenAI',
    model_args: any,
  ): Promise<any> {
    switch (chain_type) {
      case 'rag-v0':
        return this.createRAGChain(indexIds, model_type, model_args);

      default:
        throw new Error('Chain type not supported');
    }
  }

  public async createSummarizationChain(
    sum_type: SummarizationType,
  ): Promise<any> {
    const model = new OpenAI({ temperature: 0 });

    const chain = loadSummarizationChain(model as any, { type: sum_type });

    return chain;
  }

  /**
   * @description Create a question generation chain for given documents
   *
   * @param model_type: string
   * @returns questions: RunnableSequence
   */
  public async createQuestionGenerationChain(model_type: string): Promise<any> {
    Logger.log(
      `Creating question generation chain for ${model_type}`,
      'ChatService:createQuestionGenerationChain',
    );

    let model: any;
    if (model_type == 'OpenAI') {
      model = new ChatOpenAI({
        modelName: process.env.MODEL_CHAT,
      });
    } else if (model_type == 'MistralAI') {
      model = new ChatMistralAI({
        modelName: process.env.MISTRAL_MODEL_CHAT,
        apiKey: process.env.MISTRAL_API_KEY,
      });
    }

    const questionGenerationPrompt = await pull(
      process.env.PROMPT_QUESTION_GENERATION_TAG,
    );

    const splitter = new TokenTextSplitter();

    const questions = RunnableSequence.from([
      {
        context: async (input) => {
          // Add 'async' keyword here
          let tokens = await splitter.splitText(input.documents.join('\n'));
          if (!tokens) throw new Error('No tokens found');
          if (tokens.length > 8000) {
            tokens = tokens.slice(0, 8000);
            Logger.log(
              'Reducing token length',
              'ChatService:createQuestionGenerationChain:tokensLength',
            );
          }
          return tokens.join('\n');
        },
      },
      questionGenerationPrompt as any,
      model,
      new StringOutputParser(),
      {
        questions: (input) => {
          Logger.log(input, 'ChatService:createQuestionGenerationChain:input');
          return input
            .split('\n')
            .map((question: string) => {
              return question.replace(/^\d+\.\s/g, '');
            })
            .filter((question: string) => {
              return question.length > 5;
            });
        },
      },
    ]);

    return questions;
  }

  private async createRAGChain(
    chroma_indices: string[],
    model_type: string,
    model_args: any = { temperature: 0.0, max_tokens: 1000, max_retries: 4 },
  ): Promise<any> {
    // TODO: Add prior filtering for questions such as "What is new today?" (with date filter)
    // TODO: Add self-ask prompt for fact-checking
    const argv = model_args ?? {
      temperature: 0.0,
      max_tokens: 1000,
      max_retries: 4,
    };
    Logger.log(
      `Model is initialized with ${JSON.stringify(argv)}`,
      'ChatService:createRAGChain',
    );
    let model: any;
    if (model_type == 'OpenAI') {
      model = new ChatOpenAI({
        modelName: process.env.MODEL_CHAT,
        streaming: true,
        ...(model_args ?? {
          temperature: 0.0,
          max_tokens: 1000,
          max_retries: 4,
        }),
      });
    } else if (model_type == 'MistralAI') {
      model = new ChatMistralAI({
        modelName: process.env.MISTRAL_MODEL_CHAT,
        apiKey: process.env.MISTRAL_API_KEY,
      });
    }

    const vectorStore = await Chroma.fromExistingCollection(
      new TogetherAIEmbeddings({
        apiKey: process.env.TOGETHER_AI_API_KEY,
        modelName: process.env.MODEL_EMBEDDING,
      }),
      {
        url: process.env.CHROMA_URL,
        collectionName: process.env.CHROMA_COLLECTION_NAME,
        filter: {
          indexId: {
            $in: chroma_indices,
          },
        },
      },
    );

    const documentCount = await vectorStore.collection.count();
    if (!documentCount) throw new Error('Vector store not found');

    const retriever = vectorStore.asRetriever();

    const answerPrompt = await pull(process.env.PROMPT_ANSWER_TAG);

    const formatChatHistory = (chatHistory: string | string[]) => {
      if (Array.isArray(chatHistory)) {
        const updatedChat = chatHistory
          .map((dialogTurn: any) => {
            if (dialogTurn['role'] == 'user') {
              return `Human: ${dialogTurn['content']}`;
            }
            if (dialogTurn['role'] == 'assistant') {
              return `AI: ${dialogTurn['content']}`;
            }
          })
          .join('\n');
        Logger.log(updatedChat, 'ChatService:formatChatHistory');
        return updatedChat;
      }
      return '';
    };

    const answerChain = RunnableSequence.from([
      {
        context: RunnableSequence.from([
          {
            docs: async (input) => {
              const docs = await retriever.getRelevantDocuments(input.question);
              return docs;
            },
          },
          {
            docs: (input) => {
              return input.docs.map((doc: any) => {
                return doc;
              });
            },
          },
        ]),
        question: (input) => {
          Logger.log(input.question, 'ChatService:answerChain:inputQuestion');
          return input.question;
        },
        chat_history: (input) => input.chat_history,
      },
      {
        answer: RunnableSequence.from([
          {
            context: (input) => {
              const docs_with_metadata = input.context.docs.map((doc: any) => {
                return JSON.stringify(doc.metadata) + '\n' + doc.pageContent;
              });
              const serialized = docs_with_metadata.join('\n');
              return serialized;
            },
            question: (input) => {
              Logger.log(
                input.question,
                'ChatService:answerChain:inputQuestion',
              );
              return input.question;
            },
            chat_history: (input) => formatChatHistory(input.chat_history),
            relation: (input) => '',
          },
          answerPrompt as any,
          model,
          new StringOutputParser(),
        ]),
        sources: RunnableLambda.from((input) => {
          return input.context.docs.map((doc: any) => {
            return doc.metadata;
          });
        }),
      },
    ]);

    const final_chain = answerChain;

    return final_chain;
  }
}

@Module({
  imports: [ChromaModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class AgentModule {
  static register(): DynamicModule {
    Logger.debug('Registering AgentModule...', 'AgentModule:register');

    return {
      module: AgentModule,
      global: true,
      providers: [
        {
          provide: 'AGENT_METACLASS',
          useFactory: (): Agent => {
            return new Agent();
          },
        },
      ],
      exports: ['AGENT_METACLASS'],
    };
  }
}
