import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { TogetherAIEmbeddings } from '@langchain/community/embeddings/togetherai';

@Global()
@Module({})
export class ChromaModule {
  static register(apiKey: string): DynamicModule {
    return {
      module: ChromaModule,
      global: true,
      providers: [
        {
          provide: 'CHROMA_DB',
          useFactory: async (): Promise<Chroma> => {
            try {
              if (!process.env.OPENAI_API_KEY)
                throw new Error('OpenAI API key is required');

              Logger.debug(process.env.CHROMA_URL, 'ChromaModule');
              Logger.debug(process.env.CHROMA_COLLECTION_NAME, 'ChromaModule');

              const vectorStore = await Chroma.fromExistingCollection(
                new TogetherAIEmbeddings({
                  apiKey: process.env.TOGETHER_AI_API_KEY,
                  modelName: process.env.MODEL_EMBEDDING,
                }),
                {
                  collectionName: process.env.CHROMA_COLLECTION_NAME,
                  url: process.env.CHROMA_URL,
                },
              );

              const ensure = await vectorStore.ensureCollection();
              Logger.debug(
                JSON.stringify(ensure),
                'ChromaModule:ensureCollection',
              );

              const docCount = await vectorStore.collection.count();
              Logger.debug(
                `Loaded ${docCount} documents from ChromaDB`,
                'ChromaModule',
              );

              return vectorStore;
            } catch (e) {
              Logger.error('ChromaDB connection failure:', e, 'ChromaDBModule');
              throw new Error('CHROMADB_CONNECTION_FAILURE');
            }
          },
        },
      ],
      exports: ['CHROMA_DB'],
    };
  }
}
