import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';
import { UnstructuredLoader } from '@langchain/community/document_loaders/fs/unstructured';
import { JSONLoader } from 'langchain/document_loaders/fs/json';

import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';
import { MIME_TYPE } from '../schema/indexer.schema';

@Injectable()
export class IndexerService {
  constructor(private readonly httpService: HttpService) {}

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
}
