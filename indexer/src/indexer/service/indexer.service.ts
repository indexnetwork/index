import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { OpenAIEmbeddings } from '@langchain/openai';
import { UnstructuredLoader } from 'langchain/document_loaders/fs/unstructured'
import { JSONLoader } from "langchain/document_loaders/fs/json";

import { IndexRequestBody, IndexUpdateBody } from '../schema/indexer.schema';
import { HttpService } from '@nestjs/axios';
import * as fs from 'fs';
import { MIME_TYPE } from '../schema/indexer.schema';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';


@Injectable()
export class IndexerService {
    constructor(
        private readonly httpService: HttpService,
        @Inject('CHROMA_DB') private readonly chromaClient: Chroma,
    ) {
    }

    /**
     * @description Crawl any document and return its content
     * 
     * @param url Url to crawl
     * @returns Web page content
     */
    async crawl(url: string): Promise<{ url: string; content: string; }>{

        const response = await this.httpService.axiosRef({
            url: url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        });

        const content_type = response.headers['content-type'].split(';')[0];

        if (!MIME_TYPE.hasOwnProperty(content_type)) throw new Error('Unsupported content type');

        // Write the file to disk
        const file_name = `tmp/${Date.now()}.${MIME_TYPE[content_type]}`;
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
                content: docs as any
            }
        }

        // Initialize the loader
        const loader = new UnstructuredLoader(
            file_name,
            {
                apiUrl: process.env.UNSTRUCTURED_API_URL,
            }
        );

        // Load the document
        const docs = await loader.load();
        
        // Delete the file
        fs.unlinkSync(file_name);

        // Merge the documents
        let content = ''
        for (let doc of docs) {
            content = content + '\n' + doc?.pageContent;
        }

        Logger.log(`Extracted ${content.length} bytes from ${url}`, 'indexerService:crawl');

        return {
            url: url,
            content: content
        };
    }

    /**
     * @description Index a web page into ChromaDB with the given metadata
     * 
     * @param body IndexRequestBody
     * @returns Success message
     */
    async index(indexId: string, body: IndexRequestBody): Promise<{ message: string }> {

        Logger.log(`Indexing ${body.webPageContent}`, 'indexerService:index');
        
        const chromaID = await this.generateChromaID(indexId, body.webPageId);
        
        try {

            let metadata = {}

            const metadata_keys = [
                "indexId", "indexTitle", "indexCreatedAt", "indexUpdatedAt",
                "indexOwnerDID", "indexOwnerName", "indexOwnerBio",
                "webPageId", "webPageTitle", "webPageUrl",
                "webPageCreatedAt", "webPageUpdatedAt"
            ];

            metadata_keys.forEach((key) => {
                metadata[key] = body[key];
            });

            const documents = [{
                pageContent: body.webPageContent ?? '',
                metadata
            }]

            const ids = await this.chromaClient.addDocuments(documents, {ids: [chromaID] });

            return {
                message: `Successfully indexed ${body.webPageTitle} with id ${ids[0]}`
            }

        } catch (e) {
            console.log(e); throw e;
        }
    }
    
    /**
     * @description Updates the document at ChromaDB with the given indexId and indexItemId
     * 
     * @param body 
     * @returns Success or error message
     */
    async update(indexId: string , indexItemId: string, body: IndexUpdateBody): Promise<{ message: string }> {

        const chromaID = await this.generateChromaID(indexId, indexItemId);

        try {

            let updated = {
                ids: chromaID
            }
    
            if (body.embedding) { updated['embedding'] = body.embedding; }
            if (body.metadata) { updated['metadata'] = body.metadata; }
    
            const response = await this.chromaClient.collection.update(updated)

            return {
                message: `Successfully updated ${chromaID}`
            }

        } catch (e) {
            return {
                message: `Update error for ${chromaID}`
            }
        }

    }


    /**
     * @description Deletes the document from ChromaDB with the given indexId and indexItemId
     * 
     * @param body 
     * @returns Success or error message
     */
    async delete(indexId: string, indexItemId: string | null): Promise<{ message: string }> {

        let response;

        const chromaID = await this.generateChromaID(indexId, indexItemId);

        try {

            if (indexItemId) { 

                const res = await this.chromaClient.collection.get({
                    ids: [chromaID],
                    limit: 1,
                })

                if (res.ids.length === 0) Logger.log('Delete failed, document not found', 'indexerService:delete');

                const response = await this.chromaClient.collection.delete({ ids: [chromaID] }) 
            
                Logger.log(`Delete Response ${JSON.stringify(response)}`, 'indexerService:delete');
                
                // if (!response) throw new Error('Delete failed');

                return {
                    message: `Successfully deleted ${JSON.stringify(response)}`
                }

            } else {

                const res = await this.chromaClient.collection.get({
                    where: { "indexId": indexId },
                    limit: 1000,
                })
                  
                Logger.log(`Deleting ${JSON.stringify(res?.ids)}`, 'indexerService:delete');

                response = await this.chromaClient.collection.delete({ ids: res?.ids })

                // if (!response) throw new Error('Delete failed');

                return {
                    message: `Successfully deleted ${response.ids.length} documents`
                }

            }

        } catch (e) {
            return {
                message: `Delete error for ${indexId}`
            }
        }
    }

    /** 
     * @description Embed a web page into ChromaDB
     * 
     * @param content
     * @returns Embedding vector
    */
    async embed(content: string | null): Promise<{ model: string; vector: number[]; } | HttpStatus.OK>  {

        // If no content, return OK 
        // This is a temporary fix for the API for now
        if (!content) return HttpStatus.OK;

        try {

            const embeddings = new OpenAIEmbeddings({
                modelName: process.env.MODEL_EMBEDDING,
                openAIApiKey:process.env.OPENAI_API_KEY
            });

            Logger.log(`Embedding ${JSON.stringify(content)}`, 'indexerService:embed');

            const embedding = await embeddings.embedDocuments([content]);

            Logger.log(`Embedded successfully`, 'indexerService:embed');
            return {
                model: process.env.MODEL_EMBEDDING,
                vector: embedding[0]
            };
        }
        catch (e) {
            console.log(e);
        }

    }

    private async generateChromaID(indexId: string, indexItemId: string): Promise<string> {
    
        return indexId + '-' + indexItemId;
    }

}
