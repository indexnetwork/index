import { ChatOpenAI, OpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { loadSummarizationChain } from 'langchain/chains';
import { PromptTemplate } from '@langchain/core/prompts';

import {
  RunnableConfig,
  RunnableLambda,
  RunnableLike,
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
enum SummarizationType {
  map_reduce = 'map_reduce',
  stuff = 'stuff',
  refine = 'refine',
}

interface CreateDynamicChainParams {
  indexIds: string[];
  prompt: any;
  inputs: FieldMappings;
}

interface FieldMappings {
  [key: string]: string;
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
    prompt: any,
  ): Promise<any> {
    switch (chain_type) {
      case 'rag-v0':
        return this.createRAGChain(indexIds, model_type, model_args, prompt);

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

  public async createDynamicChain({
    indexIds,
    prompt,
    inputs,
  }: CreateDynamicChainParams): Promise<any> {
    const model = new ChatOpenAI({
      modelName: process.env.MODEL_CHAT as string,
      streaming: true,
      temperature: 0.0,
      maxRetries: 4,
    });

    const vectorStore = await Chroma.fromExistingCollection(
      new OpenAIEmbeddings({
        modelName: process.env.MODEL_EMBEDDING as string,
      }),
      {
        url: process.env.CHROMA_URL as string,
        collectionName: process.env.CHROMA_COLLECTION_NAME as string,
        filter: { indexId: { $in: indexIds } },
      },
    );

    const myPrompt = PromptTemplate.fromTemplate(prompt);
    const retriever = vectorStore.asRetriever();

    const baseChainSequence: { [key: string]: any } = {};

    // Add context sequence if context is defined in inputs
    if (inputs.context) {
      baseChainSequence['context'] = RunnableSequence.from([
        {
          docs: async (input: any) => {
            const docs = await retriever.getRelevantDocuments(inputs.context);
            return docs;
          },
        },
        {
          docs: (input: any) => input.docs,
        },
      ]);
    }

    // Dynamically add fields based on inputs
    Object.keys(inputs).forEach((key) => {
      if (key !== 'context' && key !== 'chat_history') {
        baseChainSequence[key] = (input: any) => input[key];
      }
    });

    // Add chat_history if defined in inputs
    if (inputs.chat_history) {
      baseChainSequence['chat_history'] = (input: any) => {
        return formatChatHistory(inputs.chat_history);
      };
    }

    const answerChainSequence: [
      RunnableLike<any, any>,
      ...RunnableLike<any, any>[],
      RunnableLike<any, any>,
    ] = [
      baseChainSequence,
      {
        answer: RunnableSequence.from([
          {
            context: (input: any) => {
              if (input.context && input.context.docs) {
                const docs_with_metadata = input.context.docs.map(
                  (doc: any) =>
                    `${JSON.stringify(doc.metadata)}\n${doc.pageContent}`,
                );
                return docs_with_metadata.join('\n');
              }
              return '';
            },
            ...Object.keys(inputs).reduce(
              (acc, key) => {
                if (key !== 'context' && key !== 'chat_history') {
                  acc[key] = (input: any) => input[key];
                }
                return acc;
              },
              {} as { [key: string]: (input: any) => any },
            ),
            ...(inputs.chat_history
              ? {
                  chat_history: (input: any) =>
                    formatChatHistory(input.chat_history),
                }
              : {}),
          },
          myPrompt as any,
          model,
          new StringOutputParser(),
        ]),
        sources: RunnableLambda.from((input: any) => {
          if (input.context && input.context.docs) {
            return input.context.docs.map((doc: any) => doc.metadata);
          }
          return [];
        }),
      },
    ];

    const chain = RunnableSequence.from(answerChainSequence);
    const { context, chat_history, ...filteredInputs } = inputs;
    return await chain.stream(filteredInputs);
  }

  private async createRAGChain(
    chroma_indices: string[],
    model_type: string,
    model_args: any = { temperature: 0.0, max_tokens: 1000, max_retries: 4 },
    prompt: any,
  ): Promise<any> {
    console.log(prompt);
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
      new OpenAIEmbeddings({ modelName: process.env.MODEL_EMBEDDING }),
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
              const docs = await retriever.getRelevantDocuments(
                input.question || input.information,
              );
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
        question: (input) => input.question,
        information: (input) => input.information,
        relation: (input) => input.relation,
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
            question: (input) => input.question,
            information: (input) => input.information,
            relation: (input) => input.relation,
            chat_history: (input) => formatChatHistory(input.chat_history),
          },
          prompt as any,
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
