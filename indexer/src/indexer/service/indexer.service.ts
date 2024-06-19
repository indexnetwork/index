import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { OpenAIEmbeddings } from '@langchain/openai';
import { UnstructuredLoader } from 'langchain/document_loaders/fs/unstructured';
import { JSONLoader } from 'langchain/document_loaders/fs/json';

import { IndexDeleteQuery, IndexUpdateBody } from '../schema/indexer.schema';
import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';
import { MIME_TYPE } from '../schema/indexer.schema';
import { TokenTextSplitter } from 'langchain/text_splitter';
import { Metadata, UpdateParams } from 'chromadb';
//what to do with this import
import { flatten } from 'safe-flat';

@Injectable()
export class IndexerService {
  constructor(
    private readonly httpService: HttpService,
    @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
  ) {}

  /**
   * @description Crawl any document and return its content
   *
   * @param url Url to crawl
   * @returns Web page content
   */
  async crawl(url: string): Promise<{ url: string; content: string }> {
    const response = await this.httpService.axiosRef({
      url: url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });

    const content_type = response.headers['content-type'].split(';')[0];

    if (!MIME_TYPE.hasOwnProperty(content_type))
      throw new Error('Unsupported content type');

    // Write the file to disk
    let file_name = `tmp/${Date.now()}.${MIME_TYPE[content_type]}`;
    const writer = fs.createWriteStream(file_name);
    response.data.pipe(writer);

    // Wait for the file to be written
    const status = new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    await status;

    // Check if the file was written
    if (!status) throw new Error('Failed to download page');

    Logger.log(`Downloaded ${url} to ${file_name}`, 'indexerService:crawl');

    // Add an exception for JSON files
    if (MIME_TYPE[content_type] === 'json') {
      const loader = new JSONLoader(file_name);
      const docs = await loader.load();
      return {
        url: url,
        content: docs as any,
      };
    }
    // Check for MIME type relevant to a webpage
    if (MIME_TYPE[content_type] === 'html') {
      const renderResponse = await fetch(process.env.CRAWLER_HOST, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });
      const jsonData = await renderResponse.json();
      if (jsonData && jsonData.content) {
        Logger.log(`Crawler was successful.`);
        file_name = `tmp/rendered-${Date.now()}.${MIME_TYPE[content_type]}`;
        const writerNew = fs.createWriteStream(file_name);
        writerNew.write(jsonData.content);
        writerNew.end();
        await new Promise((resolve, reject) => {
          writerNew.on('finish', resolve);
          writerNew.on('error', reject);
        });
      } else {
        throw new Error('Failed to render page');
      }

      Logger.log(
        `Fetched Rendered HTML and saved to ${file_name}`,
        'indexerService:crawl',
      );
    }

    // Initialize the loader
    const loader = new UnstructuredLoader(file_name, {
      apiUrl: process.env.UNSTRUCTURED_API_URL,
    });

    // Load the document
    const docs = await loader.load();

    // Delete the file
    // fs.unlinkSync(file_name);

    // Merge the documents
    let content = docs.map((doc) => doc?.pageContent).join(' ');

    // Clean the content
    content = content.replace(/\s+/g, ' ').trim();

    Logger.log(
      `Extracted ${content.length} bytes from ${url}`,
      'indexerService:crawl',
    );

    return {
      url: url,
      content: content,
    };
  }

  /**
   * @description Index a web page into ChromaDB with the given metadata
   *
   * @param body IndexRequestBody
   * @returns Success message
   */
  async index(body: any): Promise<{ message: string }> {
    Logger.log(
      `Indexing ${JSON.stringify(body)?.length} bytes`,
      'indexerService:index',
    );

    try {
      let pageContent = JSON.stringify(body.document);
      // Reduce the content size for indexing
      const splitter = new TokenTextSplitter();
      Logger.log(
        `Splitting ${pageContent.length} bytes`,
        'indexerService:index',
      );
      let tokens = await splitter.splitText(pageContent);
      if (tokens.length > 8000) {
        tokens = tokens.slice(0, 8000);
        Logger.log(
          'Reducing token length',
          'indexerService:index:tokensLength',
        );
        pageContent = tokens.join(' ');
      }

      pageContent = pageContent.replace(/(\r\n|\n|\r)/gm, ' ');
      pageContent = pageContent.replace(/ +/g, ' ');
      pageContent = pageContent.trim();

      Logger.log(`Reduced ${pageContent}`, 'indexerService:index');
      const toFlat = body.document as JSON;
      const flattenMetadata: any = flatten(toFlat);

      for (const key in flattenMetadata) {
        if (typeof flattenMetadata[key] === 'string') {
          flattenMetadata[key] =
            flattenMetadata[key].length > 300
              ? flattenMetadata[key].slice(0, 300)
              : flattenMetadata[key];
        } else {
          delete flattenMetadata[key];
        }
      }

      await this.chromaClient.collection.upsert({
        ids: [body.id],
        metadatas: [flattenMetadata],
        documents: [pageContent],
        embeddings: [body.vector],
      });

      Logger.log(`Indexed ${body.id}`, 'indexerService:index');

      return {
        message: `Successfully indexed ${body.indexTitle}`,
      };
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  /**
   * @description Updates the document at ChromaDB with the given indexId and indexItemId
   *
   * @param body
   * @returns Success or error message
   */
  async update(
    indexId: string,
    itemId: string,
    body: IndexUpdateBody,
  ): Promise<{ message: string }> {
    try {
      const response = await this.chromaClient.collection.query({
        where: {
          $and: [{ indexId: { $eq: indexId } }, { itemId: { $eq: itemId } }],
        },
        nResults: 100, // todo implement pagination
      });

      const updateRequest = {
        ids: response.ids,
      } as any;

      if (body.metadata) {
        updateRequest.metadatas = response.ids.map(() => body.metadata);
      }

      await this.chromaClient.collection.update(updateRequest);

      return {
        message: `Successfully updated ${response.ids}`,
      };
    } catch (e) {
      return {
        message: `Update error`,
      };
    }
  }

  /**
   * @description Deletes the document from ChromaDB with the given indexId
   *
   * @param body
   * @returns Success or error message
   */
  async deleteIndex(indexId: string): Promise<{ message: string }> {
    try {
      if (indexId) {
        const response = await this.chromaClient.collection.delete({
          where: {
            indexId: indexId,
          },
        });

        if (!response)
          Logger.warn(`Delete failed for ${response}`, 'indexerService:delete');

        return {
          message: `Successfully deleted ${response} documents`,
        };
      }
    } catch (e) {
      return {
        message: `Delete error`,
      };
    }
  }

  /**
   * @description Deletes the document from ChromaDB with the given indexId and indexItemId
   *
   * @param body
   * @returns Success or error message
   */
  async deleteIndexItem(
    indexId: string,
    itemId: string | null,
  ): Promise<{ message: string }> {
    try {
      const response = await this.chromaClient.collection.delete({
        where: {
          $and: [{ indexId: { $eq: indexId } }, { itemId: { $eq: itemId } }],
        },
      });

      if (!response)
        Logger.warn(`Delete failed for ${response}`, 'indexerService:delete');

      console.log('response', response);
      return {
        message: `Successfully deleted ${response} documents`,
      };
    } catch (e) {
      return {
        message: `Delete error`,
      };
    }
  }

  /**
   * @description Embed a web page into ChromaDB
   *
   * @param content
   * @returns Embedding vector
   */
  async embed(
    content: string | null,
  ): Promise<{ model: string; vector: number[] } | HttpStatus.OK> {
    // If no content, return OK
    // This is a temporary fix for the API for now
    if (!content) return HttpStatus.OK;

    try {
      const embeddings = new OpenAIEmbeddings({
        modelName: process.env.MODEL_EMBEDDING,
        openAIApiKey: process.env.OPENAI_API_KEY,
      });

      Logger.log(
        `Creates embedding ${content.length} bytes of content`,
        'indexerService:embed',
      );

      const embedding = await embeddings.embedDocuments([content]);

      Logger.log(
        `Embedded successfully, with embed length ${embedding.length}`,
        'indexerService:embed',
      );

      return {
        model: process.env.MODEL_EMBEDDING,
        vector: embedding[0],
      };
    } catch (e) {
      console.log(e.message);
    }
  }

  private async generateChromaID(indexId: string, body: any): Promise<string> {
    // fix id generation
    const randseq =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);

    return indexId + '-' + randseq;
  }
}
